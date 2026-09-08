// 冒烟测试：走 textToSpeech（sambert-camila-v1）真实合成一句西语
import 'dotenv/config';
import path from 'path';
import { textToSpeech } from '../src/services/qwenClient';

async function main() {
  const out = path.join(process.cwd(), 'uploads', 'tts', '_smoke_camila.mp3');
  console.log('输出:', out);
  const p = await textToSpeech(
    { text: '¿Qué tal? Bienvenido a tu clase de español.', speed: 1.0 },
    out
  );
  console.log('DONE:', p);
}

main().catch((e) => {
  console.error('FAIL:', e?.message || e);
  process.exit(1);
});
