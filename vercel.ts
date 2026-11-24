import { withEve } from 'eve/vercel';

export default await withEve({
  services: {
    web: {
      entrypoint: '.',
      framework: 'vite',
      buildCommand: 'npm run build',
      outputDirectory: 'dist',
    },
  },
});
