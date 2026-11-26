import { withEve } from 'eve/vercel';

export default await withEve({
  services: {
    web: {
      framework: 'vite',
      root: '.',
      buildCommand: 'npm run build',
      outputDirectory: 'dist',
      rewrites: [
        { source: '/(.*)', destination: '/index.html' },
      ],
    },
  },
  routes: [
    {
      src: '^(.*)$',
      destination: { type: 'service', service: 'web' },
    },
  ],
});
