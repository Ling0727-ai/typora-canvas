import { mountReader } from './reader.js';

let reader;
const status = document.querySelector('#status');
function open(markdown, title) {
  reader?.destroy();
  reader = mountReader({ markdown, title, onClose: () => { reader = null; status.textContent = '已返回。可以重新打开演示或本地文件。'; } });
  window.demoReader = reader;
}
document.querySelector('#sample').onclick = () => {
  const sections = Number(document.querySelector('#sections').value) || 1000;
  const chunks = ['# Typora Canvas 压力测试\n\n'];
  for (let i = 1; i <= Math.min(sections, 10000); i++) chunks.push(`## 第 ${i} 节 · 机械设计笔记\n\n这是第 ${i} 节的测试正文。齿轮传动与轴承设计需要考虑**载荷**、*转速*和疲劳寿命。Canvas 只绘制当前视口，全文存放在块模型中。 English words remain wrapped at word boundaries.\n\n- 计算载荷与选择材料\n- 校核接触疲劳强度\n\n> 注：这里是引用内容。\n\n\`\`\`js\nconst section = ${i};\nconsole.log('viewport rendering');\n\`\`\`\n\n| 项目 | 数值 |\n| --- | --- |\n| 转速 | 1200 r/min |\n| 载荷 | 500 N |\n\n`);
  open(chunks.join(''), `${sections} 节压力测试`);
};
document.querySelector('#file').onchange = async event => {
  const file = event.target.files[0];
  if (file) open(await file.text(), file.name);
};
