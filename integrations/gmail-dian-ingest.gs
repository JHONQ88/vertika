/**
 * Vértika · Ingesta Automática de Facturas Electrónicas DIAN (UBL 2.1) desde Gmail
 * Costo: $0 COP/mes (Google Apps Script gratuito)
 *
 * Flujo:
 * 1. Busca correos con adjuntos .xml o .zip que aún no tengan la etiqueta "Vertika/Procesada".
 * 2. Descomprime .zip si aplica y extrae la factura UBL 2.1 (incluyendo AttachedDocument DIAN).
 * 3. Inicia sesión en Vértika (JWT), busca el proveedor por NIT y calcula retenciones (Ley 675 / ESAL).
 * 4. Radica el borrador balanceado en Bandeja IA (POST /api/v1/pre-entries) en estado PENDIENTE.
 * 5. Etiqueta el correo como "Vertika/Procesada" para nunca duplicar una factura.
 *
 * IMPORTANTE: Las credenciales se guardan en Propiedades del Script (Configuración del proyecto ->
 * Propiedades de secuencia de comandos), nunca en texto plano en el código.
 */

var LABEL_OK = 'Vertika/Procesada';
var LABEL_ERR = 'Vertika/Error';

/**
 * Paso 1 (ejecutar una sola vez): crea el disparador automático cada 5 minutos.
 */
function instalarDisparadorCada5Min() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'procesarFacturasCorreo') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('procesarFacturasCorreo')
    .timeBased()
    .everyMinutes(5)
    .create();
  Logger.log('Disparador instalado: procesarFacturasCorreo se ejecutará cada 5 minutos.');
}

/**
 * Función principal (ejecutada por el disparador o manualmente para probar).
 */
function procesarFacturasCorreo() {
  var cfg = leerConfiguracion_();
  var labelOk = obtenerOCrearEtiqueta_(LABEL_OK);
  var labelErr = obtenerOCrearEtiqueta_(LABEL_ERR);

  var query = 'has:attachment -label:' + LABEL_OK + ' -label:' + LABEL_ERR + ' newer_than:14d';
  var threads = GmailApp.search(query, 0, 15);
  if (threads.length === 0) {
    Logger.log('Sin correos nuevos con adjuntos para procesar.');
    return;
  }

  var token = autenticarVertika_(cfg);
  var bootstrap = consultarBootstrap_(cfg, token);

  for (var t = 0; t < threads.length; t++) {
    var thread = threads[t];
    var messages = thread.getMessages();
    var procesadasEnHilo = 0;
    var huboError = false;

    for (var m = 0; m < messages.length; m++) {
      var msg = messages[m];
      var xmls = extraerXmlsDeMensaje_(msg);
      if (xmls.length === 0) continue;

      for (var x = 0; x < xmls.length; x++) {
        try {
          var factura = parsearFacturaXml_(xmls[x].contenido);
          var payload = construirPreAsiento_(factura, cfg, bootstrap, msg);
          radicarPreAsiento_(cfg, token, payload);
          procesadasEnHilo++;
          Logger.log(
            'Radicada en Bandeja IA: ' +
              factura.numero +
              ' (' +
              factura.emisor +
              ') · Total $' +
              factura.total
          );
        } catch (err) {
          huboError = true;
          Logger.log('Error procesando ' + xmls[x].nombre + ': ' + err.message);
        }
      }
    }

    if (procesadasEnHilo > 0) {
      thread.addLabel(labelOk);
    } else if (huboError) {
      thread.addLabel(labelErr);
    }
  }
}

/* ==================== Configuración y Autenticación ==================== */

function leerConfiguracion_() {
  var props = PropertiesService.getScriptProperties();
  var apiUrl = (props.getProperty('VERTIKA_API_URL') || 'https://vertika-api.onrender.com')
    .trim()
    .replace(/\/+$/, '');
  var email = (props.getProperty('VERTIKA_EMAIL') || '').trim();
  var password = (props.getProperty('VERTIKA_PASSWORD') || '').trim();
  var companyId = (props.getProperty('VERTIKA_COMPANY_ID') || 'altavista').trim();
  var defaultExpenseAccount = (props.getProperty('VERTIKA_EXPENSE_ACCOUNT') || '519510').trim();

  if (!email || !password) {
    throw new Error(
      'Faltan VERTIKA_EMAIL o VERTIKA_PASSWORD en Propiedades del Script (Configuración del proyecto).'
    );
  }

  return {
    apiUrl: apiUrl,
    email: email,
    password: password,
    companyId: companyId,
    defaultExpenseAccount: defaultExpenseAccount,
  };
}

function autenticarVertika_(cfg) {
  var res = UrlFetchApp.fetch(cfg.apiUrl + '/api/v1/auth/login', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ email: cfg.email, password: cfg.password }),
    muteHttpExceptions: true,
  });
  var code = res.getResponseCode();
  var body = JSON.parse(res.getContentText() || '{}');
  if (code < 200 || code >= 300 || !body.token) {
    throw new Error('Error autenticando en Vértika (' + code + '): ' + (body.error || res.getContentText()));
  }
  return body.token;
}

function consultarBootstrap_(cfg, token) {
  var res = UrlFetchApp.fetch(cfg.apiUrl + '/api/v1/bootstrap', {
    method: 'get',
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true,
  });
  var code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('Error leyendo bootstrap de Vértika (' + code + ')');
  }
  return JSON.parse(res.getContentText());
}

function radicarPreAsiento_(cfg, token, payload) {
  var res = UrlFetchApp.fetch(cfg.apiUrl + '/api/v1/pre-entries', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  var code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('Backend rechazó pre-asiento (' + code + '): ' + res.getContentText());
  }
  return JSON.parse(res.getContentText());
}

/* ==================== Extracción de adjuntos .xml y .zip ==================== */

function extraerXmlsDeMensaje_(msg) {
  var adjuntos = msg.getAttachments({ includeInlineImages: false, includeAttachments: true });
  var xmls = [];

  for (var i = 0; i < adjuntos.length; i++) {
    var blob = adjuntos[i];
    var nombre = (blob.getName() || '').toLowerCase();

    if (nombre.endsWith('.xml')) {
      var contenido = blob.getDataAsString('UTF-8');
      if (esFacturaDian_(contenido)) {
        xmls.push({ nombre: blob.getName(), contenido: contenido });
      }
    } else if (nombre.endsWith('.zip')) {
      try {
        var extraidos = Utilities.unzip(blob);
        for (var j = 0; j < extraidos.length; j++) {
          var sub = extraidos[j];
          var subNombre = (sub.getName() || '').toLowerCase();
          if (subNombre.endsWith('.xml')) {
            var subXml = sub.getDataAsString('UTF-8');
            if (esFacturaDian_(subXml)) {
              xmls.push({ nombre: sub.getName(), contenido: subXml });
            }
          }
        }
      } catch (e) {
        Logger.log('No se pudo descomprimir ZIP ' + blob.getName() + ': ' + e.message);
      }
    }
  }
  return xmls;
}

function esFacturaDian_(xml) {
  return /<(?:[a-zA-Z0-9_-]+:)?(?:AttachedDocument|Invoice|CreditNote)\b/i.test(xml);
}

/* ==================== Parser UBL 2.1 DIAN ==================== */

function decodeXmlEntities_(raw) {
  return raw
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function stripCdata_(raw) {
  var m = raw.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return m ? m[1] : raw;
}

function extractFirstTag_(xml, localName) {
  var re = new RegExp(
    '<(?:[a-zA-Z0-9_-]+:)?' + localName + '\\b[^>]*>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_-]+:)?' + localName + '>',
    'i'
  );
  var m = xml.match(re);
  if (!m) return '';
  return decodeXmlEntities_(stripCdata_(m[1])).trim();
}

function extractBlock_(xml, localName) {
  var re = new RegExp(
    '<(?:[a-zA-Z0-9_-]+:)?' + localName + '\\b[^>]*>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_-]+:)?' + localName + '>',
    'i'
  );
  var m = xml.match(re);
  return m ? m[1] : '';
}

function extractAllBlocks_(xml, localName) {
  var re = new RegExp(
    '<(?:[a-zA-Z0-9_-]+:)?' + localName + '\\b[^>]*>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_-]+:)?' + localName + '>',
    'gi'
  );
  var out = [];
  var m = re.exec(xml);
  while (m) {
    out.push(m[1]);
    m = re.exec(xml);
  }
  return out;
}

function parseAmount_(raw) {
  if (!raw) return 0;
  var cleaned = raw.replace(/[^0-9.,-]/g, '').trim();
  if (!cleaned) return 0;
  var lastComma = cleaned.lastIndexOf(',');
  var lastDot = cleaned.lastIndexOf('.');
  if (lastComma > lastDot && cleaned.length - lastComma - 1 <= 2) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else {
    cleaned = cleaned.replace(/,/g, '');
  }
  var num = Number(cleaned);
  return isFinite(num) ? Math.round(num) : 0;
}

function round100_(n) {
  return Math.round(n / 100) * 100;
}

function unwrapAttachedInvoice_(rawXml) {
  if (!/AttachedDocument/i.test(rawXml)) return rawXml;
  var attachmentBlock = extractBlock_(rawXml, 'Attachment');
  if (attachmentBlock) {
    var desc = extractFirstTag_(attachmentBlock, 'Description');
    if (desc && /<(?:[a-zA-Z0-9_-]+:)?(?:Invoice|CreditNote)\b/i.test(desc)) {
      return desc;
    }
  }
  var cdataMatch = rawXml.match(
    /<!\[CDATA\[([\s\S]*?<(?:[a-zA-Z0-9_-]+:)?(?:Invoice|CreditNote)\b[\s\S]*?)\]\]>/i
  );
  return cdataMatch ? cdataMatch[1] : rawXml;
}

function parsearFacturaXml_(rawXml) {
  var xml = unwrapAttachedInvoice_(rawXml.trim());
  var esNotaCredito = /<(?:[a-zA-Z0-9_-]+:)?CreditNote\b/i.test(xml);

  var numero = extractFirstTag_(xml, 'ID') || 'FE-SIN-NUM';
  var fechaRaw = extractFirstTag_(xml, 'IssueDate');
  var fecha = /^\d{4}-\d{2}-\d{2}$/.test(fechaRaw)
    ? fechaRaw
    : Utilities.formatDate(new Date(), 'America/Bogota', 'yyyy-MM-dd');
  var cufe = extractFirstTag_(xml, 'UUID') || undefined;

  var supplierBlock = extractBlock_(xml, 'AccountingSupplierParty') || xml;
  var emisor =
    extractFirstTag_(supplierBlock, 'RegistrationName') ||
    extractFirstTag_(supplierBlock, 'Name') ||
    'Proveedor DIAN';
  var nit = (extractFirstTag_(supplierBlock, 'CompanyID') || '').replace(/[^0-9]/g, '');

  var monetaryBlock = extractBlock_(xml, 'LegalMonetaryTotal') || xml;
  var subtotal = parseAmount_(extractFirstTag_(monetaryBlock, 'LineExtensionAmount'));
  var total = parseAmount_(extractFirstTag_(monetaryBlock, 'PayableAmount'));

  // IVA a nivel de documento (TaxScheme/ID = 01)
  var sinLineas = xml
    .replace(/<(?:[a-zA-Z0-9_-]+:)?InvoiceLine\b[\s\S]*?<\/(?:[a-zA-Z0-9_-]+:)?InvoiceLine>/gi, '')
    .replace(/<(?:[a-zA-Z0-9_-]+:)?CreditNoteLine\b[\s\S]*?<\/(?:[a-zA-Z0-9_-]+:)?CreditNoteLine>/gi, '');
  var taxTotals = extractAllBlocks_(sinLineas, 'TaxTotal');
  var iva = 0;
  for (var i = 0; i < taxTotals.length; i++) {
    var schemeBlock = extractBlock_(taxTotals[i], 'TaxScheme');
    var schemeId = extractFirstTag_(schemeBlock, 'ID');
    if (schemeId === '01' || (!schemeId && taxTotals.length === 1)) {
      iva += parseAmount_(extractFirstTag_(taxTotals[i], 'TaxAmount'));
    }
  }

  if (subtotal <= 0 && total > 0) subtotal = Math.max(0, total - iva);
  if (total <= 0) total = subtotal + iva;
  if (total <= 0) {
    throw new Error('No se encontró un valor monetario válido en el XML.');
  }

  var firstLine = extractBlock_(xml, 'InvoiceLine') || extractBlock_(xml, 'CreditNoteLine') || '';
  var desc =
    extractFirstTag_(firstLine, 'Description') ||
    extractFirstTag_(xml, 'Note') ||
    (esNotaCredito ? 'Nota crédito electrónica ' : 'Factura electrónica ') + numero;

  return {
    esNotaCredito: esNotaCredito,
    numero: numero,
    fecha: fecha,
    emisor: emisor,
    nit: nit,
    cufe: cufe,
    subtotal: subtotal,
    iva: iva,
    total: total,
    descripcion: desc.slice(0, 140),
  };
}

/* ==================== Clasificación PUC y Partida Doble ==================== */

function clasificarCuentaGasto_(texto, defaultAccount) {
  var s = (texto || '').toLowerCase();
  if (/vigilancia|seguridad|guarda|celadur/.test(s)) return '513505';
  if (/aseo|limpieza|jardin|cafeter/.test(s)) return '513510';
  if (/energ|enel|codensa|epm|electric/.test(s)) return '513515';
  if (/acueducto|agua|alcantarillado|eaab/.test(s)) return '513525';
  if (/ascensor|elevador|mantenimiento|bomba|planta/.test(s)) return '514505';
  if (/honorar|contador|revisor|abogad|juridic|asesor/.test(s)) return '511005';
  if (/seguro|poliza|póliza/.test(s)) return '513005';
  return defaultAccount || '519510';
}

function construirPreAsiento_(factura, cfg, bootstrap, msg) {
  var terceros = (bootstrap.datos && bootstrap.datos.terceros) || [];
  var tercero = null;
  for (var i = 0; i < terceros.length; i++) {
    var doc = String(terceros[i].documento || '').replace(/[^0-9]/g, '');
    if (factura.nit && doc && (doc === factura.nit || factura.nit.indexOf(doc) === 0)) {
      tercero = terceros[i];
      break;
    }
  }
  if (!tercero) {
    for (var j = 0; j < terceros.length; j++) {
      if (terceros[j].tipo === 'PROPIETARIO') continue;
      if (!terceros[j].empresaId || terceros[j].empresaId === cfg.companyId) {
        tercero = terceros[j];
        break;
      }
    }
  }
  if (!tercero) {
    throw new Error('No se encontró un tercero proveedor configurado en Vértika.');
  }

  var cuentaGasto = clasificarCuentaGasto_(
    factura.emisor + ' ' + factura.descripcion,
    cfg.defaultExpenseAccount
  );
  var periodo = factura.fecha.slice(0, 7);

  // En Propiedad Horizontal (ESAL no responsable de IVA), el IVA es mayor valor del gasto
  var gastoTotal = factura.subtotal + factura.iva;
  var retefuente = round100_(factura.subtotal * (Number(tercero.retefuentePct || 0) / 100));
  var reteica = round100_(factura.subtotal * (Number(tercero.reteicaPct || 0) / 100));
  var reteiva = round100_(factura.iva * (Number(tercero.reteivaPct || 0) / 100));
  var netoProveedor = gastoTotal - retefuente - reteica - reteiva;

  var lines = [];
  if (factura.esNotaCredito) {
    lines.push({
      cuenta: '220505',
      terceroId: tercero.id,
      detalle: 'Reversión CxP ' + factura.numero + ' · ' + factura.emisor,
      debito: netoProveedor,
      credito: 0,
    });
    if (retefuente > 0) {
      lines.push({ cuenta: '236540', terceroId: tercero.id, detalle: 'Ajuste ReteFuente ' + factura.numero, debito: retefuente, credito: 0 });
    }
    if (reteica > 0) {
      lines.push({ cuenta: '236801', terceroId: tercero.id, detalle: 'Ajuste ReteICA ' + factura.numero, debito: reteica, credito: 0 });
    }
    if (reteiva > 0) {
      lines.push({ cuenta: '236705', terceroId: tercero.id, detalle: 'Ajuste ReteIVA ' + factura.numero, debito: reteiva, credito: 0 });
    }
    lines.push({
      cuenta: cuentaGasto,
      terceroId: tercero.id,
      detalle: factura.descripcion,
      debito: 0,
      credito: gastoTotal,
    });
  } else {
    lines.push({
      cuenta: cuentaGasto,
      terceroId: tercero.id,
      detalle: factura.descripcion + (factura.iva > 0 ? ' (incluye IVA mayor valor ESAL)' : ''),
      debito: gastoTotal,
      credito: 0,
    });
    if (retefuente > 0) {
      lines.push({ cuenta: '236540', terceroId: tercero.id, detalle: 'ReteFuente ' + factura.numero, debito: 0, credito: retefuente });
    }
    if (reteica > 0) {
      lines.push({ cuenta: '236801', terceroId: tercero.id, detalle: 'ReteICA ' + factura.numero, debito: 0, credito: reteica });
    }
    if (reteiva > 0) {
      lines.push({ cuenta: '236705', terceroId: tercero.id, detalle: 'ReteIVA ' + factura.numero, debito: 0, credito: reteiva });
    }
    lines.push({
      cuenta: '220505',
      terceroId: tercero.id,
      detalle: 'CxP ' + factura.numero + ' · ' + factura.emisor,
      debito: 0,
      credito: netoProveedor,
    });
  }

  return {
    companyId: cfg.companyId,
    period: periodo,
    entryType: factura.esNotaCredito ? 'NC' : 'CC',
    date: factura.fecha,
    agent: 'Gmail DIAN · Ingesta Automática',
    confianza: factura.nit && String(tercero.documento || '').replace(/[^0-9]/g, '') === factura.nit ? 96 : 84,
    terceroId: tercero.id,
    description: (factura.esNotaCredito ? 'NC ' : 'FE ') + factura.numero + ' · ' + factura.emisor,
    document: {
      tipo: factura.esNotaCredito ? 'NOTA_CREDITO' : 'FACTURA_ELECTRONICA',
      numero: factura.numero,
      fecha: factura.fecha,
      emisor: factura.emisor,
      nit: factura.nit || tercero.documento,
      cufe: factura.cufe,
      subtotal: factura.subtotal,
      iva: factura.iva,
      total: factura.total,
      archivo: 'Gmail · ' + msg.getSubject().slice(0, 80),
      items: [
        {
          descripcion: factura.descripcion,
          cantidad: 1,
          valorUnitario: factura.subtotal,
          subtotal: factura.subtotal,
        },
      ],
    },
    lines: lines,
    notes: [
      'Recibida automáticamente desde Gmail (' + msg.getFrom() + ').',
      'Asunto: ' + msg.getSubject(),
      'Verifique cuenta PUC ' + cuentaGasto + ' y tercero ' + tercero.nombre + ' antes de asentar con F10.',
    ],
  };
}

function obtenerOCrearEtiqueta_(nombre) {
  return GmailApp.getUserLabelByName(nombre) || GmailApp.createLabel(nombre);
}
