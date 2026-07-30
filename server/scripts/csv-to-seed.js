#!/usr/bin/env node
'use strict';

// ─── CSV/Excel → 单词本 seed JSON 转换脚本（多单词本） ───
// 用法：node scripts/csv-to-seed.js <csv/xlsx 路径> [单词本名称] [输出json路径]
//
//   - 每个 CSV 或 Excel 对应一个单词本，输出到 server/src/data/wordbooks/
//   - 单词本名称可从第 3 个参数指定，未指定时从文件名自动推断
//     （去掉"表格_"前缀及扩展名）
//   - 默认输出到 src/data/wordbooks/<单词本名称>.json
//
// 列结构（一行一词，Excel 取第一个 Sheet）：
//   0 动词原形 | 1 中文释义 | 2 文中变位/形式 | 3 中文情景句 | 4 西语原句 | 5 拓展搭配&语法要点
//
// 第 2 列形如「leemos（陈述现在时第一复）」「baila（三单）」「me ducho（一单自复）」
//   - 括号内含人称标记 → 解析为 conjugation 对象（人称 → 变位形式）
//   - 含「原形 / 虚拟式 / 命令式 / 搭配」等 → 不入 conjugation

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

// 中文人称简称 → 西语人称键
const PERSON_MAP = {
  '一单': 'yo',
  '二单': 'tú',
  '三单': 'él/ella/usted',
  '一复': 'nosotros',
  '第一复': 'nosotros',
  '二复': 'vosotros',
  '三复': 'ellos/ellas/ustedes',
};

// 简易 CSV 解析：兼容引号包裹、字段内逗号、转义双引号（"" → "）
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* 忽略 */ }
      else field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

// 解析整列变位数据（支持 | 分隔多个变位形式）
// 格式示例：descubre（三单） | 第一人称(yo): descubro | 第二人称(tú): descubres | 第三人称(él/ella/usted): descubre
function parseFullConjugation(raw) {
  if (!raw) return {};
  const conjugation = {};
  // 切分各变位片段
  const parts = raw.split(/\s*\|\s*/);
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    // 跳过原形/虚拟/命令/搭配等非变位描述
    if (/原形|虚拟|命令|搭配/.test(trimmed)) continue;

    // 格式1: 第一人称(yo): descubro  或  第三人称(él/ella/usted): descubre
    const mNamed = trimmed.match(/^第[一二三]人称\s*[(（](.+?)[)）]\s*:\s*(.+)$/);
    if (mNamed) {
      const person = mNamed[1].trim();
      const form = mNamed[2].trim();
      if (person && form) conjugation[person] = form;
      continue;
    }

    // 格式2: descubre（三单） — 提取中文人称简称
    const mDesc = trimmed.match(/^(.+?)[（(](.+?)[)）]\s*$/);
    if (mDesc) {
      const form = mDesc[1].trim();
      const desc = mDesc[2].trim();
      for (const key of Object.keys(PERSON_MAP)) {
        if (desc.includes(key)) { conjugation[PERSON_MAP[key]] = form; break; }
      }
      continue;
    }

    // 格式3: descubre（él/ella/usted）— 括号内直接是西语人称
    const mNative = trimmed.match(/^(.+?)[（(](yo|tú|él\/ella\/usted|nosotros|vosotros|ellos\/ellas\/ustedes)[)）]\s*$/);
    if (mNative) {
      conjugation[mNative[2].trim()] = mNative[1].trim();
    }
  }
  // 至少存一个人称才返回；否则 {}
  return Object.keys(conjugation).length > 0 ? { '陈述式现在时': conjugation } : {};
}

// 从文件名推断单词本名称（去掉常见前缀与扩展名）
function inferName(filePath) {
  let name = path.basename(filePath).replace(/\.(csv|xlsx?)$/i, '');
  name = name.replace(/^表格[_\s-]*/i, '').replace(/^sheet[_\s-]*/i, '');
  name = name.trim();
  return name || '未命名单词本';
}

// 单词本 course_tag 映射（可根据文件名或内容扩展）
function inferCourseTag(name) {
  if (/动词|verbo|变位/.test(name)) return '动词';
  if (/名词|sustantivo/.test(name)) return '名词';
  if (/形容词|adjetivo/.test(name)) return '形容词';
  if (/副词|adverbio/.test(name)) return '副词';
  if (/短语|frase/.test(name)) return '短语';
  if (/日常|对话|口语/.test(name)) return '日常';
  return '默认';
}

// 根据单词本名称推断词性
function inferPartOfSpeech(name) {
  if (/副词|adverbio/.test(name)) return 'adverbio';
  if (/名词|sustantivo/.test(name)) return 'sustantivo';
  if (/形容词|adjetivo/.test(name)) return 'adjetivo';
  if (/短语/.test(name)) return 'frase';
  return 'verbo'; // 默认动词
}

// 支持 .csv / .xlsx / .xls，统一返回按行切分的字符串数组
function readInputToRows(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  let text;

  if (ext === '.csv') {
    text = fs.readFileSync(filePath, 'utf-8');
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // 去 BOM
  } else if (ext === '.xlsx' || ext === '.xls') {
    const workbook = XLSX.readFile(filePath);
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!firstSheet) throw new Error('Excel 文件没有工作表');
    text = XLSX.utils.sheet_to_csv(firstSheet, { FS: ',', RS: '\n' });
  } else {
    throw new Error(`不支持的文件格式：${ext}，请使用 .csv / .xlsx / .xls`);
  }

  return parseCSV(text);
}

function main() {
  const inputArg = process.argv[2];
  if (!inputArg) {
    console.error('❌ 用法：npm run seed:csv -- <csv/xlsx 路径> [单词本名称] [输出json路径]');
    process.exit(1);
  }

  const inputPath = path.resolve(process.cwd(), inputArg);
  if (!fs.existsSync(inputPath)) {
    console.error('❌ 找不到输入文件：', inputPath);
    process.exit(1);
  }

  const bookName = process.argv[3] || inferName(inputPath);
  const outPath = process.argv[4]
    ? path.resolve(process.cwd(), process.argv[4])
    : path.join(__dirname, '..', 'src', 'data', 'wordbooks', bookName + '.json');

  const rows = readInputToRows(inputPath);
  const words = [];
  let skipped = 0;

  for (const r of rows) {
    const word = (r[0] || '').trim();
    const chineseMeaning = (r[1] || '').trim();
    // 跳过表头与无释义的空白行
    if (!word || !chineseMeaning) { skipped++; continue; }
    if (word === '动词原形' || word === '原形') continue; // 表头

    const conjugationRaw = (r[2] || '').trim();
    const zh = (r[3] || '').trim();
    const es = (r[4] || '').trim();
    const notes = (r[5] || '').trim();

    const entry = {
      word,
      partOfSpeech: inferPartOfSpeech(bookName),
      chineseMeaning,
      originalForm: word,
      conjugation: parseFullConjugation(conjugationRaw),
      sentences: es ? [{ es, zh }] : [],
    };
    if (notes) entry.notes = notes;
    words.push(entry);
  }

  const seed = {
    version: 2,
    wordbook: {
      name: bookName,
      sourceType: 'seed',
      courseTag: inferCourseTag(bookName),
    },
    words,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(seed, null, 2), 'utf-8');

  console.log(`✅ "${bookName}" 转换完成：${words.length} 词，跳过 ${skipped} 行`);
  console.log(`📄 输出：${outPath}`);
}

main();
