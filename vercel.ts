import { withEve } from 'eve/vercel';

export default await withEve({
  services: {
    web: {
      framework: 'vite',
      root: '.',
      buildCommand: 'npm run build',
      outputDirectory: 'dist',
    },
  },
  routes: [
    {
      src: '^(.*)$',
      destination: { type: 'service', service: 'web' },
    },
  ],
});
