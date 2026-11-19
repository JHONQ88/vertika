import { withEve } from 'eve/vercel';

export default await withEve({
  experimentalServices: {
    web: {
      entrypoint: '.',
      framework: 'vite',
      buildCommand: 'npm run build',
      outputDirectory: 'dist',
    },
  },
});
