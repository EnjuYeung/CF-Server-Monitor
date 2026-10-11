import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('./', import.meta.url));
export async function buildTheme(output = resolve('output/theme-minimal')) {
  await mkdir(join(output, 'assets'), { recursive: true });
  let html = await readFile(join(source, 'index.html'), 'utf8');
  for (const [name, ext] of [['app', 'js'], ['style', 'css']]) {
    const body = await readFile(join(source, 'assets', `${name}.${ext}`));
    const hash = createHash('sha256').update(body).digest('hex').slice(0, 12);
    const filename = `${name}-${hash}.${ext}`;
    await writeFile(join(output, 'assets', filename), body);
    html = html.replace(`./assets/${name}.${ext}`, `./assets/${filename}`);
  }
  await writeFile(join(output, 'index.html'), html);
  return output;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`Theme built: ${await buildTheme()}`);
}
