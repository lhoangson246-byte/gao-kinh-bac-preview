import { fixture, run } from './fixture.mjs';

for (const suite of ['smoke', 'retail', 'manage']) {
  const app = await fixture();
  try {
    const result = await run(`test/${suite}.mjs`, { ...app.env, BASE: app.base });
    console.log(result.output);
    if (result.code !== 0) process.exitCode = 1;
  } finally { await app.close(); }
}
