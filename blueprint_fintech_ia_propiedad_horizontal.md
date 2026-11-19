# Blueprint Técnico y de Producto: Fintech e IA de Contabilidad Autónoma para Propiedad Horizontal

## 1. El Problema Estructural: La Desconexión entre Recaudo, Administración y Contabilidad en Copropiedades

La administración de edificios, conjuntos residenciales y centros comerciales en Colombia opera hoy bajo un esquema fragmentado donde el residente, el administrador y el contador trabajan en silos desconectados. Aunque toda copropiedad sometida al régimen de la [Ley 675 de 2001](https://www.dian.gov.co/fizcalizacioncontrol/herramienconsulta/NIIF/Orientaciones%20CTCP/Documento15_Orientacion_tecnica_15_Copropiedades_uso_residencial_o_mixto_guia.pdf) es una Entidad Sin Ánimo de Lucro (ESAL) obligada a llevar contabilidad formal bajo los marcos técnicos NIIF de Grupo 2 o Grupo 3 ([Concepto 179 sobre NIIF en Propiedad Horizontal - CR Consultores](https://crconsultorescolombia.com/concepto-no-179-la-propiedad-horizontal-debe-aplicar-niif.php)), las herramientas tradicionales del mercado fueron diseñadas para registrar el pasado y no para automatizar la operación financiera del conjunto en tiempo real.

### 1.1 Los Cuatro Cuellos de Botella que Asfixian a las Administraciones

* **Software contable genérico y digitación manual repetitiva:** Herramientas clásicas de escritorio como [Contaí de Ilimitada (Grupo Siigo)](https://ilimitada.portaldeclientes.siigo.com/contai/) fueron concebidas para contadores multicompañía que digitan asientos manualmente por teclado ([Asentar o Contabilizar Movimiento en Contaí](https://ilimitada.portaldeclientes.siigo.com/asentar-o-contabilizar-movimiento-en-contai/)) y operan mediante carpetas locales multimes ([Instalación Contaí Multimes y Ruta](https://ilimitada.portaldeclientes.siigo.com/instalacion-contai-multimes-y-ruta/)). Incluso en módulos adaptados como [Siigo Propiedad Horizontal](https://siigocontador.portaldeclientes.siigo.com/propiedad-horizontal-en-siigo-contador/), la carga de novedades mensuales por unidad suele depender de subir archivos de Excel ([Interfaces desde Excel en Propiedad Horizontal - Siigo](https://siigocontador.portaldeclientes.siigo.com/interfaces-desde-excel-novedades-por-inmuebes-propiedad-horizontal/)) o de parametrizar manualmente planes de cuentas comerciales que no traen de fábrica la estructura ESAL exigida por la [Orientación Técnica No. 15 del CTCP](https://www.supersolidaria.gov.co/sites/default/files/gad_2025/archivos_niif/20251020_orien_tec_015.pdf).
* **Fricción en el recaudo, morosidad y conciliación tardía:** El incumplimiento en el pago de expensas comunes impacta directamente el flujo de caja y la ejecución presupuestal de los conjuntos cerrados ([Evaluación del Incumplimiento de Expensas Comunes - Universidad Libre](https://repository.unilibre.edu.co/server/api/core/bitstreams/cf085de7-6950-41a7-bb27-b96cf2235f9c/content)). Cuando el propietario o inquilino paga por transferencia bancaria tradicional, debe enviar el comprobante por correo o WhatsApp y esperar a que la administración cruce manualmente el extracto bancario y digite el recibo de caja ([Generación de Recibos en Propiedad Horizontal - Siigo](https://siigopyme2.portaldeclientes.siigo.com/generacion-de-recibos-propiedad-horizontal/)), generando demoras en la entrega de paz y salvos y errores de imputación ([Conciliación Bancaria en Conjuntos Residenciales - Verifiko](https://verifiko.co/blog/conciliacion-bancaria-conjuntos-residenciales)).
* **Confusión financiera entre Propietario e Inquilino (Arrendatario):** En una misma unidad habitacional conviven cobros ordinarios y de uso (cuota de administración mensual, reserva de salón social, multas de convivencia) que suele pagar el arrendatario, junto con cobros patrimoniales (cuotas extraordinarias de fachada o ascensores) a cargo del propietario ([Apertura de Inmuebles en Propiedad Horizontal - Siigo](https://siigopyme2.portaldeclientes.siigo.com/apertura-inmuebles-propiedad-horizontal/)). Los sistemas actuales obligan a emitir todo a un solo tercero o a dividir cuentas manualmente.
* **Riesgo legal por biometría en porterías frente a alternativas NFC:** Muchos conjuntos han instalado lectores de huella o reconocimiento facial obligatorio para controlar el acceso, exponiéndose a investigaciones y multas de hasta 2.000 SMLMV de la Superintendencia de Industria y Comercio (como la Resolución SIC 52185 de 2025 bajo la Ley 1581 de 2012) por recolectar datos biométricos sensibles sin ofrecer alternativas ([Guía Legal de Biometría y Tags NFC en Propiedad Horizontal - Alarmar](https://alarmar.com.co/datos-biometricos-controles-acceso-edificios-conjuntos/)).

| Dimensión Operativa | Esquema Tradicional (Contador Externo + [Contaí](https://ilimitada.portaldeclientes.siigo.com/contai/) / [Siigo PH](https://siigocontador.portaldeclientes.siigo.com/propiedad-horizontal-en-siigo-contador/)) | Nuestra Solución: Fintech + Agentes IA para Copropiedades |
| :--- | :--- | :--- |
| **Experiencia de Pago (Residente / Inquilino)** | Pide estado de cuenta al administrador ([Estado de Cuenta PH - Siigo](https://siigopyme2.portaldeclientes.siigo.com/generar-estado-de-cuenta-propiedad-horizontal/)), transfiere manualmente y envía captura de pantalla esperando validación. | Acerca el celular a su **Tag NFC** ([Tarjetas y Tags NFC en PH - Alarmar](https://alarmar.com.co/datos-biometricos-controles-acceso-edificios-conjuntos/)), elige perfil **Inquilino** o **Propietario**, y paga en 10 segundos por PSE, tarjeta o llave inmediata **[Bre-B](https://www.banrep.gov.co/es/bre-b/que-es)**. |
| **Conciliación Bancaria y Recibos de Caja** | El contador o administrador cruza el extracto bancario a fin de mes y digita recibos tipo R uno por uno ([Documento Tipo R Recibos - Siigo](https://siigocontador.portaldeclientes.siigo.com/documento-tipo-r-recibos/)). | Un webhook de la pasarela ([Wompi Docs](https://docs.wompi.co/docs/colombia/metodos-de-pago/)) y el **Agente IA Conciliador** identifican el pago al instante, aplican prelación legal (mora, sanción, capital) y emiten el Paz y Salvo en vivo ([Software Contable PH - KaiLiving](https://kailiving.app/contabilidad/)). |
| **Causación de Facturas de Proveedores** | El administrador entrega una carpeta de facturas en papel o PDF al contador para que las digite semanas después ([Automatizar Facturas Electrónicas - Gaussiana](https://gaussiana.io/automatizacion-de-facturas/)). | El **Agente IA de Causación** lee el archivo **XML UBL 2.1 de la DIAN** ([Causación Automática de Facturas con IA - GouJana](https://goujana.co/causacion-automatica-de-facturas-con-ia)), liquida retenciones, afecta el presupuesto y deja el asiento listo en el PUC ESAL. |
| **Pago a Proveedores y Contratistas (Tesorería)** | El administrador entra al portal bancario a inscribir cuentas y dispersar pagos manualmente uno a uno. | La administración aprueba las facturas causadas y dispersa el lote completo a cuentas bancarias, billeteras o llaves Bre-B mediante API ([Wompi Payouts API](https://docs.wompi.co/en/docs/colombia/introduccion-pagos-a-terceros/)). |
| **Cierre Contable, Impuestos y Asamblea** | El contador entrega balances atrasados en hojas de cálculo que el administrador no entiende ([Reportes de Movimiento en Contaí](https://ilimitada.portaldeclientes.siigo.com/reportes-de-movimiento-contai/)). | El contador entra a una consola rápida tipo Contaí donde el 95% ya está causado bajo el [DOT 15 del INCP](https://incp.org.co/wp-content/uploads/2024/06/DOT-No.-15-Propiedades-horizontales-de-uso-residencial-o-mixto-Grupos-2-y-3-2024.pdf), audita en minutos y exporta informes de Asamblea y Exógena DIAN ([Medios Magnéticos Contaí](https://ilimitada.portaldeclientes.siigo.com/generar-medios-magneticos-contai-2025/)). |

## 2. Propuesta de Valor: Por Qué las Administraciones Nos Prefieren Frente a un Contador Tradicional

El objetivo comercial del proyecto es que el administrador de propiedad horizontal o la empresa administradora vea en nuestra plataforma un **motor financiero y operativo integral** que hace diez veces más trabajo diario que un servicio contable tradicional, sin desplazar al contador sino multiplicando su productividad:

* **Eliminación del 90% de la carga operativa del administrador:** Mientras un contador externo solo recibe papeles a fin de mes para armar estados financieros históricos, nuestra plataforma le resuelve al administrador el **cobro diario**, la **emisión automática de paz y salvos**, la **lectura de facturas de proveedores**, el **control de ejecución presupuestal en vivo** y el **pago dispersado a terceros** ([Wompi x Payouts](https://wompi.com/es/co/soluciones/payouts.html)).
* **Cumplimiento tributario DIAN en piloto automático (RADIAN y Documento Soporte):** Cuando un conjunto residencial contrata personal de mantenimiento, jardinería o arreglos locativos que no está obligado a facturar electrónicamente, la plataforma genera y transmite en un clic el [Documento Soporte en Adquisiciones con No Obligados de la DIAN](https://www.dian.gov.co/impuestos/Paginas/Sistema-de-Factura-Electronica/Documento-Soporte-Adquisiciones-No-Obligados.aspx) y automatiza los tres eventos obligatorios del sistema RADIAN dentro del plazo legal de tres días hábiles ([Automatización de Eventos RADIAN y Documento Soporte - XMS](https://xmslatam.com/co/automatizar-radian-documento-soporte-dian/)).
* **Gestión inteligente y legal de cartera morosa:** El sistema envía recordatorios preventivos por WhatsApp antes de que venza el descuento por pronto pago ([Conceptos de Facturación y Descuentos PH - Siigo](https://siigopyme2.portaldeclientes.siigo.com/crear-conceptos-de-facturacion-propiedad-horizontal/)), congela intereses automáticamente cuando se firma un acuerdo de pago ([Apertura de Inmuebles y Cartera Congelada - Siigo](https://siigopyme2.portaldeclientes.siigo.com/apertura-inmuebles-propiedad-horizontal/)) y genera listados de morosos ajustados a la jurisprudencia de la [Sentencia T-106/02 de la Corte Constitucional](https://www.corteconstitucional.gov.co/relatoria/2002/t-106-02).
* **Entorno de alta velocidad para el Contador ("Contaí en la Nube con IA"):** El contador de la copropiedad no pierde el control técnico que tenía en [Contaí](https://ilimitada.portaldeclientes.siigo.com/contai/): conserva atajos de teclado, libros auxiliares, gestión multicompañía para llevar 20 o 50 conjuntos desde un solo panel, depreciación de activos fijos y certificados de retención ([Certificados Tributarios en Contaí](https://ilimitada.portaldeclientes.siigo.com/generar-reportes-tributarios-certificados-en-contai/)), pero recibe todos los asientos pre-contabilizados y conciliados al centavo.

## 3. Arquitectura del Motor Fintech: Recaudo NFC, Pagos Inmediatos y Tesorería

La capa Fintech transforma a cada copropiedad en un ecosistema financiero automatizado que conecta el mundo físico del conjunto (portería, ascensores y apartamentos) con los rieles bancarios de Colombia.

### 3.1 Experiencia Física-Digital con Tags NFC (Acceso + Pago en 1 Toque)

* **Hardware NFC sin fricción ni riesgos de Habeas Data:** Se implementan chips **NTAG213 o NTAG215** en dos formatos: (1) un **llavero o tarjeta NFC** individualizada por residente para abrir porterías y zonas comunes sin capturar datos biométricos sensibles ([Tarjetas RFID y Tags NFC en PH - Alarmar](https://alarmar.com.co/datos-biometricos-controles-acceso-edificios-conjuntos/)), y (2) un **Sticker NFC inteligente** instalado en el interior de la puerta de cada apartamento o en la cartelera del ascensor.
* **Web App Instantánea (Zero-Install) con URL Criptográfica:** Al acercar cualquier smartphone (Android o iPhone) al Tag NFC, el lector nativo del sistema operativo abre en menos de un segundo una aplicación web progresiva (`https://pay.tuplataforma.co/u/{token_unidad}`) sin obligar al residente a descargar aplicaciones ni recordar contraseñas para pagar.
* **Billetera Dual por Inmueble (Separación Propietario vs. Inquilino):** La interfaz precarga automáticamente la unidad inmobiliaria y muestra dos pestañas independientes según la parametrización del inmueble ([Apertura de Inmuebles PH - Siigo](https://siigopyme2.portaldeclientes.siigo.com/apertura-inmuebles-propiedad-horizontal/)):
  * **Cuenta Arrendatario (Inquilino):** Cuota de administración ordinaria (con cálculo dinámico del descuento por pronto pago según la fecha del día), cobro de parqueadero adicional, reserva de zonas comunes (BBQ, salón social) y multas de convivencia.
  * **Cuenta Propietario:** Cuotas extraordinarias aprobadas en asamblea, aportes especiales al Fondo de Imprevistos y reparaciones estructurales.

### 3.2 Rieles de Recaudo (Pay-In) y Conciliación Instantánea

* **Pasarela Transaccional Embebida (PSE, Tarjetas, Nequi y Corresponsales):** Integración directa vía API con pasarelas locales respaldadas por la banca colombiana ([Métodos de Pago - Wompi Docs](https://docs.wompi.co/docs/colombia/metodos-de-pago/)). Permite tanto el pago puntual por PSE/Nequi como la **tokenización cifrada de tarjetas** mediante estándares `RSA-OAEP-256` y `AES-GCM-256` para que el propietario o inquilino active el **débito automático mensual** de su administración ([Tokenización de Pagos Recurrentes - Wompi](https://wompi.com/es/co/soluciones/pagos-en-linea/webcheckout-api-plugins/tokenizacion)).
* **Integración con Pagos Inmediatos Interoperables ([Bre-B del Banco de la República](https://www.banrep.gov.co/es/bre-b/que-es)):** Aprovechando la entrada en operación plena de la interoperabilidad de **[Bre-B](https://www.banrep.gov.co/es/noticias/bre-b-continua-avanzando)**, cada copropiedad (o cada pago generado desde el Tag NFC) presenta su llave o código QR interoperable para recibir transferencias inmediatas 24/7 desde cualquier entidad financiera o billetera participante en Colombia ([Entidades Participantes de Bre-B - Banco de la República](https://www.banrep.gov.co/es/bre-b/preguntas-frecuentes/participantes)).
* **Financiamiento de Cuotas Extraordinarias (BNPL Embebido):** Cuando una asamblea aprueba una cuota extraordinaria alta (por ejemplo, impermeabilización o cambio de ascensores), el checkout ofrece dividir el pago en cuotas mensuales para el propietario mientras el conjunto recibe la liquidez de inmediato ([Métodos de Pago BNPL - Wompi Docs](https://docs.wompi.co/en/docs/colombia/metodos-de-pago/)).
* **Open Finance e Iniciación de Pagos:** Siguiendo la tendencia líder del ecosistema colombiano —donde el 60,9% de las Fintech adopta Open Finance y APIs bajo el marco de la Superintendencia Financiera ([Finnovista Fintech Radar Colombia](https://www.finnovista.com/wp-content/uploads/2023/07/Radar-Finnovista-Colombia-2023-VFinal.pdf))—, el motor se conecta mediante APIs bancarias para leer movimientos de cuentas recaudadoras en tiempo real.

### 3.3 Rieles de Dispersión y Tesorería Automatizada (Pay-Out)

* **Pagos Masivos a Proveedores en 1 Clic (`Payouts API`):** Una vez que el administrador aprueba las facturas de vigilancia, aseo, ascensores y servicios públicos causadas por la IA, el sistema construye un lote JSON (`POST /v1/batches`) con control de idempotencia y dispersa el dinero directamente desde la cuenta de la copropiedad hacia las cuentas bancarias, billeteras digitales o llaves Bre-B de todos los proveedores ([Third-Party Payments API - Wompi Docs](https://docs.wompi.co/en/docs/colombia/introduccion-pagos-a-terceros/)).
* **Contabilización y Comprobante de Egreso Automático:** Cuando el webhook de dispersión confirma el pago exitoso de cada proveedor ([Create Your First Batch - Wompi Docs](https://docs.wompi.co/en/docs/colombia/crea-tu-primer-lote/)), el sistema genera automáticamente el Comprobante de Egreso, cruza la cuenta por pagar en el PUC ESAL y envía por correo/WhatsApp al proveedor el soporte de pago junto con su certificado de retención practicada.

## 4. Arquitectura de Agentes de IA: Contabilidad Invisible y Determinista

Para que el contador confíe plenamente en el sistema, aplicamos una regla de oro de ingeniería financiera: **los modelos de IA (LLMs) interpretan documentos no estructurados y proponen clasificaciones, pero un Motor Contable Determinista valida y ejecuta la partida doble**. Así garantizamos cero alucinaciones numéricas y mantenemos la restricción estricta de [Siigo Contador](http://miprimerblogpcnt.blogspot.com/p/siigo-contador.html) y [Contaí](https://ilimitada.portaldeclientes.siigo.com/asentar-o-contabilizar-movimiento-en-contai/) de impedir cualquier comprobante descuadrado.

| Agente de IA | Fuente de Entrada (Input) | Procesamiento Técnico (IA + Reglas) | Acción Operativa y Contable (Output) | Marco Técnico / Estándar |
| :--- | :--- | :--- | :--- | :--- |
| **1. Agente Causador DIAN y Servicios Públicos** | Buzón de correo del conjunto con archivos **XML UBL 2.1 DIAN** ([Recepción Automática Facturas DIAN - Facele](https://facele.co/como-automatizar-la-recepcion-de-facturas-electronicas-de-tus-proveedores-en-colombia/)) y fotos/PDFs de recibos públicos o cuentas de cobro. | Parsea el XML oficial o aplica Visión/OCR ([Facturación Automática por OCR - Mentora](https://mentoracolombia.com/automatizacion-facturacion-electronica)); identifica proveedor, NIT, base, IVA, retenciones (ReteFuente, ReteICA) y mapea al **PUC ESAL** y al rubro del presupuesto anual. | Crea el asiento de causación en borrador, emite eventos **RADIAN** o **Documento Soporte DIAN** ([MATIAS API DIAN](https://matias-api.com/documentos-electronicos-dian/)) y prepara la orden de pago en lote. | [Causación Automática con IA - GouJana](https://goujana.co/causacion-automatica-de-facturas-con-ia) y [Documento Soporte DIAN](https://www.dian.gov.co/impuestos/Paginas/Sistema-de-Factura-Electronica/Documento-Soporte-Adquisiciones-No-Obligados.aspx). |
| **2. Agente Conciliador de Recaudos y Cartera** | Webhooks de pasarela ([Wompi Docs](https://docs.wompi.co/docs/colombia/metodos-de-pago/)), notificaciones **[Bre-B](https://www.banrep.gov.co/es/bre-b)**, extractos bancarios en PDF/CSV y fotos de consignaciones enviadas por residentes. | Cruza referencias de pago, montos y cédulas/NITs contra las unidades del conjunto; calcula intereses de mora diarios y valida si aplica descuento por pronto pago o acuerdo de cartera congelada ([Recibos Tipo R - Siigo](https://siigocontador.portaldeclientes.siigo.com/documento-tipo-r-recibos/)). | Asienta el Recibo de Caja en el PUC ESAL (cruzando anticipos si existen), actualiza el saldo de la unidad en vivo y libera el **Paz y Salvo con QR** ([Software Contable PH - KaiLiving](https://kailiving.app/contabilidad/)). | [Conciliación Bancaria en Conjuntos - Verifiko](https://verifiko.co/blog/conciliacion-bancaria-conjuntos-residenciales). |
| **3. Agente Liquidador de Coeficientes y Presupuesto** | Presupuesto anual aprobado en Asamblea, tabla de coeficientes de copropiedad y novedades del mes (multas, reservas, lecturas de agua/gas). | Verifica que la suma de coeficientes sea exactamente 100%, distribuye cuotas ordinarias, extraordinarias y el porcentaje legal del **Fondo de Imprevistos** ([Orientación Técnica 15 - INCP](https://incp.org.co/wp-content/uploads/2024/06/DOT-No.-15-Propiedades-horizontales-de-uso-residencial-o-mixto-Grupos-2-y-3-2024.pdf)). | Genera y envía masivamente las cuentas de cobro el día 1 de cada mes por correo/WhatsApp y actualiza los saldos en los **Tags NFC** de cada unidad ([Generación de Facturación PH - Siigo](https://siigopyme2.portaldeclientes.siigo.com/generacion-e-impresion-de-facturacion-propiedad-horizontal/)). | [Ley 675 de 2001 - Documento Técnico 15 DIAN](https://www.dian.gov.co/fizcalizacioncontrol/herramienconsulta/NIIF/Orientaciones%20CTCP/Documento15_Orientacion_tecnica_15_Copropiedades_uso_residencial_o_mixto_guia.pdf). |
| **4. Agente Conserje 24/7 (NFC + WhatsApp)** | Consultas de propietarios e inquilinos desde el portal del **Tag NFC** o WhatsApp oficial de la administración. | Consulta en lenguaje natural con generación aumentada por recuperación (RAG) sobre el reglamento de propiedad horizontal, estado de cuenta de la unidad y calendario de zonas comunes. | Entrega estados de cuenta separados (inquilino/propietario), cobra reservas de zonas comunes, registra quejas en la bitácora ([Bitácora PH - Siigo](https://siigopyme2.portaldeclientes.siigo.com/bitacora-propiedad-horizontal/)) y responde dudas de cobros sin intervención humana. | [Software Contable PH - KaiLiving](https://kailiving.app/contabilidad/). |
| **5. Agente Auditor Contable y Copiloto de Asamblea** | Libro diario/mayor en el PUC ESAL, ejecución presupuestal mensual y saldos de bancos/fondo de imprevistos. | Detecta anomalías (desviaciones presupuestales >10%, retenciones mal aplicadas, desfase entre efectivo en cuenta restringida del Fondo de Imprevistos y su cuenta contable). | Prepara el pre-cierre para el contador, genera los archivos XML de **Medios Magnéticos DIAN** ([Medios Magnéticos Contaí 2025](https://ilimitada.portaldeclientes.siigo.com/generar-medios-magneticos-contai-2025/)) y redacta el informe financiero y las notas NIIF para la Asamblea ([DOT 15 - Supersolidaria](https://www.supersolidaria.gov.co/sites/default/files/gad_2025/archivos_niif/20251020_orien_tec_015.pdf)). | [Marco Técnico Normativo Grupo 3 - CIJUF](https://cijuf.org.co/sites/cijuf.org.co/files/normatividad/anexos/ANEXO%203-MARCO-TECNICO-NORMATIVO-GRUPO-3.pdf). |

## 5. Stack Tecnológico Recomendado para Construir la Fintech + PropTech

Siguiendo principios de arquitectura cliente-servidor desacoplada, alta disponibilidad e integridad transaccional para sistemas financieros, este es el stack tecnológico diseñado para construir y escalar el producto:

| Capa de Arquitectura | Tecnologías Seleccionadas | Justificación Técnica y Caso de Uso en el Proyecto |
| :--- | :--- | :--- |
| **Frontend Residente (NFC Instant WebApp / PWA)** | **Next.js (React) + TypeScript + Tailwind CSS** con soporte de **Web NFC API** | Carga instantánea (<1 segundo) al acercar el celular al Tag NFC ([Tags NFC en PH - Alarmar](https://alarmar.com.co/datos-biometricos-controles-acceso-edificios-conjuntos/)) sin pasar por tiendas de aplicaciones; diseño limpio y adaptable para pagar en 2 toques. |
| **Frontend Administrador y Consola Contador (Estilo Contaí)** | **React + TanStack Table / AG Grid + Hotkeys (Atajos de teclado)** | Permite al administrador ver tableros visuales de presupuesto/cartera y le da al contador una grilla ultrarrápida manejable 100% con teclado como en [Contaí de Ilimitada](https://ilimitada.portaldeclientes.siigo.com/contai/). |
| **Backend Core & API Gateway** | **NestJS (Node.js / TypeScript)** + **FastAPI (Python)** | NestJS gestiona la lógica multi-copropiedad (multi-tenant), autenticación, webhooks de pagos y APIs REST; FastAPI ejecuta los microservicios de IA, parsing de XML DIAN ([Automatización Facturación DIAN - ItsQuery](https://blog.itsquery.com/posts/como-automatizar-facturacion-electronica-colombia/)) y OCR. |
| **Motor de Ledger Contable (Partida Doble Inmutable)** | **PostgreSQL 16 (ACID con aislamiento `SERIALIZABLE`)** | Garantiza que cada asiento en el PUC ESAL cumpla `SUM(débitos) = SUM(créditos)` a nivel de base de datos, evitando condiciones de carrera cuando entran cientos de pagos simultáneos por PSE/Bre-B ([Wompi Docs](https://docs.wompi.co/docs/colombia/metodos-de-pago/)). |
| **Memoria Vectorial, Colas y Caché en Tiempo Real** | **pgvector + Redis + BullMQ** | `pgvector` indexa el reglamento de cada copropiedad y el historial de proveedores para los Agentes IA; BullMQ procesa en segundo plano lotes de facturación mensual, envíos de WhatsApp y lotes de dispersión ([Wompi Payouts API](https://docs.wompi.co/en/docs/colombia/introduccion-pagos-a-terceros/)). |
| **Capa de Inteligencia Artificial y OCR** | ** Orquestador de Agentes con `Structured Outputs` (JSON Schema) + Parser UBL 2.1** | Extrae con precisión determinista los nodos del XML firmado de la DIAN ([Causación Automática con IA - GouJana](https://goujana.co/causacion-automatica-de-facturas-con-ia)) y usa visión multimodal para recibos escaneados, devolviendo objetos JSON tipados listos para el motor contable. |
| **Integraciones Fintech, DIAN y Mensajería (Colombia)** | **Wompi API (Pay-in / Payouts) + Rieles Bre-B + API DIAN (Factura/Documento Soporte/RADIAN) + WhatsApp Cloud API** | Conecta recaudos PSE/Nequi/Tarjetas ([Métodos de Pago Wompi](https://docs.wompi.co/docs/colombia/metodos-de-pago/)), pagos inmediatos [Bre-B](https://www.banrep.gov.co/es/bre-b), emisión de [Documento Soporte DIAN](https://www.dian.gov.co/impuestos/Paginas/Sistema-de-Factura-Electronica/Documento-Soporte-Adquisiciones-No-Obligados.aspx) via [MATIAS API](https://matias-api.com/documentos-electronicos-dian/) o [Alegra API](https://e-provider-docs.alegra.com/reference/createinvoice), y notificaciones interactivas. |
| **Seguridad, Cifrado y Cumplimiento Legal** | **Cifrado JWE (`RSA-OAEP-256` / `AES-GCM-256`) + Row-Level Security (RLS) + Logs de Auditoría** | Protege tokens de pago ([Tokenización Wompi Docs](https://docs.wompi.co/docs/colombia/metodos-de-pago/)), aísla estrictamente los datos de cada conjunto residencial por rol y cumple con el régimen colombiano de protección de datos personales Ley 1581 de 2012 ([Software Contable PH - KaiLiving](https://kailiving.app/contabilidad/)). |

## 6. Diseño del Modelo de Datos (SQL) y Motor de Asientos Automáticos

Para superar las limitaciones de los archivos planos de [Contaí](https://ilimitada.portaldeclientes.siigo.com/generar-intercambio-de-datos-en-contai/) y las parametrizaciones manuales de [Siigo Propiedad Horizontal](https://siigopyme2.portaldeclientes.siigo.com/apertura-inmuebles-propiedad-horizontal/), la base de datos relacional une en un solo modelo las **unidades inmobiliarias**, los **vínculos duales (propietario vs. arrendatario)**, los **Tags NFC** y el **Ledger Contable PUC ESAL**:

```sql
-- 1. Copropiedades (Multi-Tenant: permite al contador o firma manejar N conjuntos)
CREATE TABLE copropiedades (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nit VARCHAR(20) UNIQUE NOT NULL,
    razon_social VARCHAR(200) NOT NULL,
    grupo_niif SMALLINT NOT NULL CHECK (grupo_niif IN (2, 3)), -- Decreto 2420 / DOT 15 CTCP
    porcentaje_fondo_imprevistos NUMERIC(5,2) DEFAULT 1.00,   -- Mínimo 1% Ley 675 de 2001
    tasa_mora_mensual NUMERIC(6,4) NOT NULL,
    dia_corte_pronto_pago SMALLINT DEFAULT 10,
    llave_bre_b VARCHAR(100),                                 -- Riel de pagos inmediatos Banrep
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Unidades Inmobiliarias (Grupos/Torres, Coeficientes y Estado de Cartera)
CREATE TABLE unidades_inmobiliarias (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    copropiedad_id UUID NOT NULL REFERENCES copropiedades(id),
    grupo_torre VARCHAR(20) NOT NULL,                         -- Ej: 'Torre A', 'Bloque 1'
    numero_unidad VARCHAR(20) NOT NULL,                       -- Ej: '402'
    matricula_inmobiliaria VARCHAR(50),
    coeficiente NUMERIC(9,6) NOT NULL CHECK (coeficiente > 0),-- Suma por copropiedad = 100.000000
    esta_arrendado BOOLEAN DEFAULT FALSE,
    cartera_congelada BOOLEAN DEFAULT FALSE,                  -- Bloquea mora por acuerdo de pago
    fecha_congelacion DATE,
    UNIQUE (copropiedad_id, grupo_torre, numero_unidad)
);

-- 3. Terceros y Vínculo Dual por Unidad (Separación Propietario vs. Inquilino)
CREATE TABLE vinculos_unidad_tercero (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unidad_id UUID NOT NULL REFERENCES unidades_inmobiliarias(id),
    tercero_id UUID NOT NULL,                                 -- Referencia a tabla de NITs/Cédulas
    rol_en_unidad VARCHAR(20) NOT NULL CHECK (rol_en_unidad IN ('PROPIETARIO', 'ARRENDATARIO')),
    recibe_cobro_ordinario BOOLEAN DEFAULT TRUE,
    recibe_cobro_extraordinario BOOLEAN DEFAULT FALSE,
    activo BOOLEAN DEFAULT TRUE
);

-- 4. Tags NFC Físicos (Stickers de Apartamento y Llaveros de Acceso)
CREATE TABLE tags_nfc (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unidad_id UUID NOT NULL REFERENCES unidades_inmobiliarias(id),
    uid_fisico_chip VARCHAR(64) UNIQUE NOT NULL,              -- UID del chip NTAG213/215
    tipo_tag VARCHAR(20) NOT NULL CHECK (tipo_tag IN ('STICKER_PAGO', 'LLAVERO_ACCESO')),
    token_url_firmado VARCHAR(255) UNIQUE NOT NULL,
    activo BOOLEAN DEFAULT TRUE
);

-- 5. Catálogo PUC ESAL y Rubros Presupuestales de Asamblea
CREATE TABLE puc_esal_cuentas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    copropiedad_id UUID NOT NULL REFERENCES copropiedades(id),
    codigo_cuenta VARCHAR(20) NOT NULL,                       -- Ej: '41700501' Cuota Ordinaria
    nombre_cuenta VARCHAR(150) NOT NULL,
    naturaleza CHAR(1) NOT NULL CHECK (naturaleza IN ('D', 'C')),
    rubro_presupuesto_id UUID,                                -- Cruce directo con Presupuesto Anual
    UNIQUE (copropiedad_id, codigo_cuenta)
);

-- 6. Cabecera y Movimientos del Ledger Contable (Partida Doble Estricta)
CREATE TABLE comprobantes_contables (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    copropiedad_id UUID NOT NULL REFERENCES copropiedades(id),
    tipo_documento VARCHAR(10) NOT NULL,                      -- 'RC' Recibo Caja, 'CC' Causación, 'CE' Egreso
    consecutivo BIGINT NOT NULL,
    fecha_contable DATE NOT NULL,
    origen_creacion VARCHAR(30) NOT NULL,                     -- 'AGENTE_IA_DIAN', 'WEBHOOK_NFC', 'CONTADOR_MANUAL'
    estado VARCHAR(20) DEFAULT 'ASENTADO' CHECK (estado IN ('BORRADOR_IA', 'ASENTADO', 'ANULADO')),
    url_soporte_xml_pdf TEXT,
    UNIQUE (copropiedad_id, tipo_documento, consecutivo)
);

CREATE TABLE movimientos_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    comprobante_id UUID NOT NULL REFERENCES comprobantes_contables(id),
    cuenta_id UUID NOT NULL REFERENCES puc_esal_cuentas(id),
    unidad_id UUID REFERENCES unidades_inmobiliarias(id),     -- Auxiliar por apartamento
    tercero_id UUID NOT NULL,
    debito NUMERIC(18,2) DEFAULT 0.00 CHECK (debito >= 0),
    credito NUMERIC(18,2) DEFAULT 0.00 CHECK (credito >= 0),
    descripcion VARCHAR(250) NOT NULL
);
```

### Ejemplo de Flujo Automático End-to-End (De 0 a 100% sin Digitación)

1. **Día 1 del mes (Liquidación automática):** El **Agente Liquidador** toma el presupuesto mensual aprobado en asamblea, multiplica por el `coeficiente` de cada inmueble ([Software Contable PH - KaiLiving](https://kailiving.app/contabilidad/)) y separa los cargos ordinarios (asignados al `ARRENDATARIO` si el inmueble está arrendado) de las cuotas extraordinarias (asignadas al `PROPIETARIO`), generando el asiento contable de causación masiva en el PUC ESAL ([Apertura de Inmuebles PH - Siigo](https://siigopyme2.portaldeclientes.siigo.com/apertura-inmuebles-propiedad-horizontal/)).
2. **Día 5 del mes (Pago en 1 toque con Tag NFC):** El inquilino del Apto 402 acerca su celular al sticker NFC en su puerta, ve su cuota con el descuento por pronto pago vigente y paga por PSE o llave **[Bre-B](https://www.banrep.gov.co/es/bre-b/que-es)**. El webhook confirma la transacción en 2 segundos, el **Agente Conciliador** asienta el Recibo de Caja debitando Bancos, acreditando Cuentas por Cobrar de la unidad y registrando el gasto/menor valor por descuento de pronto pago, y envía el Paz y Salvo por WhatsApp.
3. **Día 15 del mes (Llegada de factura electrónica de empresa de vigilancia):** El proveedor envía su factura electrónica al correo del conjunto. El **Agente Causador DIAN** lee el XML UBL 2.1 ([Causación Automática de Facturas con IA - GouJana](https://goujana.co/causacion-automatica-de-facturas-con-ia)), registra el acuse de recibo en el **RADIAN** ([Automatización RADIAN - XMS](https://xmslatam.com/co/automatizar-radian-documento-soporte-dian/)), liquida la retención sobre el AIU de vigilancia, descuenta el valor del rubro "Seguridad y Vigilancia" del presupuesto anual y deja la orden lista en el panel del administrador para dispersar el pago vía API ([Wompi Payouts](https://wompi.com/es/co/soluciones/payouts.html)).
4. **Día 30 del mes (Revisión del Contador en Consola tipo Contaí):** El contador abre su consola multiconjunto, revisa el semáforo del **Agente Auditor**, aprueba con un atajo de teclado los asientos de depreciación/provisiones ([Depreciación y Provisiones en Contaí](https://ilimitada.portaldeclientes.siigo.com/contai/)) y publica con un clic el paquete financiero para el Consejo de Administración y la Asamblea.

## 7. Modelo de Monetización Fintech + SaaS y Hoja de Ruta de Desarrollo

A diferencia de un software contable tradicional que solo cobra una licencia fija, una **Fintech + PropTech** captura valor en tres capas complementarias, permitiendo ofrecer un precio de entrada sumamente atractivo para que las administraciones se cambien sin dudarlo:

| Vía de Ingresos (Revenue Stream) | Cómo Funciona | Ventaja Competitiva frente a Competidores Tradicionales |
| :--- | :--- | :--- |
| **1. Suscripción SaaS Escalonada por Unidades** | Tarifa mensual por copropiedad según número de unidades (ej. hasta 50, 150 o +300 unidades), incluyendo usuarios ilimitados para Administrador, Contador, Revisor Fiscal y Consejo, más el kit inicial de **Tags NFC** ([Tags NFC en PH - Alarmar](https://alarmar.com.co/datos-biometricos-controles-acceso-edificios-conjuntos/)). | Reemplaza el costo separado de pagar software contable + plataforma de citofonía/portería + horas extras de digitación administrativa ([Mejores Software PH Colombia - Sipho](https://sipho.com.co/mejores-software-propiedad-horizontal-colombia)). |
| **2. Fee Transaccional Fintech (Recaudo + Dispersión)** | Margen o comisión por transacción procesada en la pasarela de recaudo NFC/Web ([Planes y Tarifas Wompi](https://wompi.com/es/co/planes-tarifas/)) y micro-comisión por pago dispersado en lote a proveedores ([Wompi Payouts API](https://docs.wompi.co/en/docs/colombia/introduccion-pagos-a-terceros/)). | Genera ingresos recurrentes crecientes a medida que sube el volumen de pagos digitales en cada edificio. |
| **3. Finanzas Embebidas (Embedded Finance)** | Originación de créditos BNPL para propietarios con cuotas extraordinarias ([Métodos de Pago BNPL - Wompi Docs](https://docs.wompi.co/en/docs/colombia/metodos-de-pago/)), adelanto de flujo de caja sobre cartera para obras urgentes del conjunto y pólizas obligatorias de áreas comunes (Ley 675). | Se alinea con el segmento de mayor levantamiento de capital en Colombia: **Open Finance & Embedded Finance** y **Lending** ([Finnovista Fintech Radar Colombia](https://www.finnovista.com/wp-content/uploads/2023/07/Radar-Finnovista-Colombia-2023-VFinal.pdf)). |

### Hoja de Ruta (Roadmap de Ingeniería en 3 Fases)

* **Fase 1 (Semanas 1 a 6) — Core Contable PUC ESAL + Recaudo NFC / PSE:** Construcción de la base de datos multi-copropiedad, motor de partida doble con el PUC ESAL ([DOT 15 - Supersolidaria](https://www.supersolidaria.gov.co/sites/default/files/gad_2025/archivos_niif/20251020_orien_tec_015.pdf)), liquidación automática por coeficientes, separación Propietario/Inquilino y Web App instantánea para Tags NFC integrada con pasarela de pagos ([Wompi Docs](https://docs.wompi.co/docs/colombia/metodos-de-pago/)) y **[Bre-B](https://www.banrep.gov.co/es/bre-b)**.
* **Fase 2 (Semanas 7 a 12) — Agentes de IA (Causación DIAN + Conciliación + WhatsApp):** Puesta en marcha del lector automático de XML DIAN ([Causación Automática con IA - GouJana](https://goujana.co/causacion-automatica-de-facturas-con-ia)) y OCR de recibos públicos, emisión de [Documento Soporte DIAN](https://www.dian.gov.co/impuestos/Paginas/Sistema-de-Factura-Electronica/Documento-Soporte-Adquisiciones-No-Obligados.aspx), bot conserje de WhatsApp para residentes y consola rápida con atajos de teclado para el contador ([Portal Contaí - Siigo](https://ilimitada.portaldeclientes.siigo.com/contai/)).
* **Fase 3 (Semanas 13 a 18) — Tesorería Automatizada (Payouts) + Copiloto de Asamblea + Embedded Finance:** Activación de dispersión masiva a proveedores ([Wompi Payouts](https://wompi.com/es/co/soluciones/payouts.html)), generador automático de Medios Magnéticos DIAN ([Medios Magnéticos Contaí](https://ilimitada.portaldeclientes.siigo.com/generar-medios-magneticos-contai-2025/)), informes ejecutivos de Asamblea en un clic y módulo de financiación de cuotas extraordinarias.

## 8. Referencias y Fuentes Técnicas Verificadas

* [Documento de Orientación Técnica No. 15 — Copropiedades de Uso Residencial o Mixto (DIAN / CTCP)](https://www.dian.gov.co/fizcalizacioncontrol/herramienconsulta/NIIF/Orientaciones%20CTCP/Documento15_Orientacion_tecnica_15_Copropiedades_uso_residencial_o_mixto_guia.pdf)
* [Orientación Técnica No. 15 Actualizada — Propiedades Horizontales Grupos 2 y 3 (Supersolidaria)](https://www.supersolidaria.gov.co/sites/default/files/gad_2025/archivos_niif/20251020_orien_tec_015.pdf)
* [Orientación Técnica No. 15 — Instituto Nacional de Contadores Públicos (INCP)](https://incp.org.co/wp-content/uploads/2024/06/DOT-No.-15-Propiedades-horizontales-de-uso-residencial-o-mixto-Grupos-2-y-3-2024.pdf)
* [Anexo 3: Marco Técnico Normativo para Microempresas Grupo 3 (CIJUF)](https://cijuf.org.co/sites/cijuf.org.co/files/normatividad/anexos/ANEXO%203-MARCO-TECNICO-NORMATIVO-GRUPO-3.pdf)
* [Concepto Nº 179 — Aplicación de NIIF en Propiedad Horizontal (CR Consultores Colombia)](https://crconsultorescolombia.com/concepto-no-179-la-propiedad-horizontal-debe-aplicar-niif.php)
* [Centro de Documentación Técnica de Contaí — Ilimitada / Siigo](https://ilimitada.portaldeclientes.siigo.com/contai/)
* [Asentar o Contabilizar Movimiento en Contaí — Ilimitada / Siigo](https://ilimitada.portaldeclientes.siigo.com/asentar-o-contabilizar-movimiento-en-contai/)
* [Instalación de Contaí Multimes y Estructura de Rutas — Ilimitada / Siigo](https://ilimitada.portaldeclientes.siigo.com/instalacion-contai-multimes-y-ruta/)
* [Generación de Medios Magnéticos DIAN en Contaí — Ilimitada / Siigo](https://ilimitada.portaldeclientes.siigo.com/generar-medios-magneticos-contai-2025/)
* [Generación de Certificados Tributarios en Contaí — Ilimitada / Siigo](https://ilimitada.portaldeclientes.siigo.com/generar-reportes-tributarios-certificados-en-contai/)
* [Módulo de Propiedad Horizontal en Siigo Contador — Portal de Clientes Siigo](https://siigocontador.portaldeclientes.siigo.com/propiedad-horizontal-en-siigo-contador/)
* [Apertura de Inmuebles, Coeficientes, Arrendatarios y Cartera Congelada — Siigo Pyme](https://siigopyme2.portaldeclientes.siigo.com/apertura-inmuebles-propiedad-horizontal/)
* [Creación de Conceptos de Facturación y Descuentos en Propiedad Horizontal — Siigo Pyme](https://siigopyme2.portaldeclientes.siigo.com/crear-conceptos-de-facturacion-propiedad-horizontal/)
* [Documento Tipo R (Recibos de Caja e Intereses Diarios en PH) — Siigo Contador](https://siigocontador.portaldeclientes.siigo.com/documento-tipo-r-recibos/)
* [Interfaces desde Excel para Novedades por Inmuebles — Siigo Contador](https://siigocontador.portaldeclientes.siigo.com/interfaces-desde-excel-novedades-por-inmuebes-propiedad-horizontal/)
* [Bitácora de Quejas y Novedades en Propiedad Horizontal — Siigo Pyme](https://siigopyme2.portaldeclientes.siigo.com/bitacora-propiedad-horizontal/)
* [Software Contable Especializado para Propiedad Horizontal (PUC ESAL) — KaiLiving](https://kailiving.app/contabilidad/)
* [Comparativa de Software de Propiedad Horizontal en Colombia — Sipho](https://sipho.com.co/mejores-software-propiedad-horizontal-colombia)
* [Legalidad de Biometría vs. Tarjetas RFID y Tags NFC en Propiedad Horizontal (Ley 1581) — Alarmar](https://alarmar.com.co/datos-biometricos-controles-acceso-edificios-conjuntos/)
* [Documentación Técnica de Métodos de Pago y Tokenización JWE — Wompi Docs](https://docs.wompi.co/docs/colombia/metodos-de-pago/)
* [API de Dispersión de Pagos a Terceros (Payouts API) — Wompi Docs](https://docs.wompi.co/en/docs/colombia/introduccion-pagos-a-terceros/)
* [Creación de Lotes de Dispersión Programada — Wompi Docs](https://docs.wompi.co/en/docs/colombia/crea-tu-primer-lote/)
* [Soluciones de Dispersión a Cuentas, Billeteras y Llaves Bre-B — Wompi Payouts](https://wompi.com/es/co/soluciones/payouts.html)
* [Planes y Tarifas Transaccionales — Wompi Colombia](https://wompi.com/es/co/planes-tarifas/)
* [Sistema de Pagos Inmediatos Interoperables Bre-B — Banco de la República de Colombia](https://www.banrep.gov.co/es/bre-b/que-es)
* [Regulación de Interoperabilidad en Sistemas de Pago Inmediatos Bre-B — Banco de la República](https://www.banrep.gov.co/es/normatividad/sistemas-pago/pagos-inmediatos-bre-b)
* [Finnovista Fintech Radar Colombia — Adopción de Open Finance, Pagos y Embedded Finance](https://www.finnovista.com/wp-content/uploads/2023/07/Radar-Finnovista-Colombia-2023-VFinal.pdf)
* [Causación Automática de Facturas Electrónicas XML DIAN con IA — GouJana ERP](https://goujana.co/causacion-automatica-de-facturas-con-ia)
* [Recepción Automática de Facturas Electrónicas y Eventos DIAN — Facele Colombia](https://facele.co/como-automatizar-la-recepcion-de-facturas-electronicas-de-tus-proveedores-en-colombia/)
* [Automatización de Eventos RADIAN y Documento Soporte Electrónico — XMS Latam](https://xmslatam.com/co/automatizar-radian-documento-soporte-dian/)
* [Documento Soporte en Adquisiciones con Sujetos No Obligados a Facturar — DIAN](https://www.dian.gov.co/impuestos/Paginas/Sistema-de-Factura-Electronica/Documento-Soporte-Adquisiciones-No-Obligados.aspx)
* [API de Documentos Electrónicos DIAN (Factura, Nómina, Documento Soporte, RADIAN) — MATIAS API](https://matias-api.com/documentos-electronicos-dian/)
* [Conciliación Bancaria Automatizada en Conjuntos Residenciales — Verifiko](https://verifiko.co/blog/conciliacion-bancaria-conjuntos-residenciales)
* [Evaluación del Incumplimiento del Pago de Expensas Comunes y Ejecución Presupuestal — Universidad Libre](https://repository.unilibre.edu.co/server/api/core/bitstreams/cf085de7-6950-41a7-bb27-b96cf2235f9c/content)
* [Sentencia T-106/02 sobre Cobro de Expensas Comunes y Listas de Morosos en Conjuntos — Corte Constitucional](https://www.corteconstitucional.gov.co/relatoria/2002/t-106-02)
