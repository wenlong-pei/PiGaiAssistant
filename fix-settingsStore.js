const fs = require('fs');
let c = fs.readFileSync('src/store/settingsStore.ts', 'utf8');

// 修复1：aiStudioToken 只用 realToken，不用 state 里的值
c = c.replace(
  "              aiStudioToken: realToken || currentState.paddleOcrToken,",
  "              aiStudioToken: realToken || '',  // 只用 realToken，不用 state 里的值（可能是哨兵值）"
);

fs.writeFileSync('src/store/settingsStore.ts', c, 'utf8');
console.log('Done');
