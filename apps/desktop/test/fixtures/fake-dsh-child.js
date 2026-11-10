// 测试用的假内核进程：代替真 DSH，只模拟“启动成功 / 启动后死掉 / 启动失败”三种情况。
//   node fake-dsh-child.js ok    打印 ready，标准输入关了就退出
//   node fake-dsh-child.js die   打印 ready，50 毫秒后以 3 退出
//   node fake-dsh-child.js fail  不打印 ready，直接以 1 退出
const mode = process.argv[2] || 'ok';
if (mode === 'fail') {
  process.stderr.write('假内核：启动失败\n');
  process.exit(1);
}
process.stdout.write('ready\n');
process.stderr.write('假内核：已启动\n');
if (mode === 'die') setTimeout(() => process.exit(3), 50);
process.stdin.on('data', (d) => process.stdout.write(`echo:${d}`));
process.stdin.on('end', () => process.exit(0));
setInterval(() => {}, 1000);
