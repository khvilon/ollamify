// Функция рендеринга страницы PDF
export async function render_page(pageData) {
  let renderOptions = {
    normalizeWhitespace: true,
    disableCombineTextItems: false
  };
  
  return pageData.getTextContent(renderOptions)
    .then(function(textContent) {
      let lastY, text = '';
      for (let item of textContent.items) {
        if (lastY == item.transform[5] || !lastY){
          text += item.str;
        } else {
          text += '\n' + item.str;
        }
        lastY = item.transform[5];
      }
      return text;
    });
}

// Проверка на бинарное содержимое
function isBinaryContent(buffer) {
  // Проверяем первые 512 байт
  const sampleLength = Math.min(512, buffer.length);
  for (let i = 0; i < sampleLength; i++) {
    const byte = buffer[i];
    // Проверяем на непечатаемые символы, исключая пробелы, табы, переносы строк
    if (byte < 9 || (byte > 13 && byte < 32) || byte === 127) {
      return true;
    }
  }
  return false;
}

// Очистка текста от невалидных символов.
// Сохраняет абзацную структуру (\n\n), чтобы чанкер мог использовать её
// для смыслового разбиения.
export function sanitizeText(text) {
  if (!text) return '';
  
  // Convert buffer to string if needed
  if (Buffer.isBuffer(text)) {
    // Проверяем на бинарное содержимое
    if (isBinaryContent(text)) {
      throw new Error('Binary content detected, cannot process this file type');
    }
    text = text.toString('utf8');
  }
  
  return text
    .replace(/\0/g, '')                                   // Remove null bytes
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')   // Remove control chars except \n (\x0A) and \r (\x0D)
    .replace(/[^\p{L}\p{N}\p{P}\p{Z}\p{M}\n]/gu, '')     // Буквы, цифры, пунктуация, пробелы + переносы строк
    .replace(/\r\n/g, '\n')                                // Нормализуем CRLF -> LF
    .replace(/[ \t]+/g, ' ')                               // Схлопываем горизонтальные пробелы/табы
    .replace(/\n /g, '\n')                                 // Убираем пробел после переноса
    .replace(/ \n/g, '\n')                                 // Убираем пробел перед переносом
    .replace(/\n{3,}/g, '\n\n')                            // 3+ переносов -> абзацный разделитель
    .trim();
}
