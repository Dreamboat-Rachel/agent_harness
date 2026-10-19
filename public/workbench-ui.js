const paths = {
  spark: '<path d="m12 2 2.7 7.3L22 12l-7.3 2.7L12 22l-2.7-7.3L2 12l7.3-2.7Z"/><path d="m20 2 .6 1.4L22 4l-1.4.6L20 6l-.6-1.4L18 4l1.4-.6Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  memory: '<path d="M9 4a3 3 0 0 0-5 3 4 4 0 0 0-1 7 4 4 0 0 0 6 5M15 4a3 3 0 0 1 5 3 4 4 0 0 1 1 7 4 4 0 0 1-6 5M9 3v18m6-18v18M5 10l4 2m6 2 4-2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  graph: '<circle cx="12" cy="4" r="2"/><circle cx="4" cy="18" r="2"/><circle cx="20" cy="18" r="2"/><circle cx="12" cy="13" r="2"/><path d="M12 6v5m-1.7 3-4.6 3m8-3 4.6 3"/>',
  tools: '<path d="M9 3v5m6-5v5M7 8h10v3a5 5 0 0 1-10 0Zm5 8v5"/>',
  settings: '<path d="m9 3-1 3-3 1-2 4 2 2v4l4 3 3-1 3 1 4-3v-4l2-2-2-4-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M15 4v16"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  arrow: '<path d="M12 20V4m-6 6 6-6 6 6"/>',
  right: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  code: '<path d="m8 7-5 5 5 5m8-10 5 5-5 5M14 4l-4 16"/>',
  document: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Zm0 0v6h6M8 13h8m-8 4h5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  folder: '<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L9 17l-4 1 1-4Z"/>',
};

export function icon(name) {
  return `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.spark}</svg>`;
}

export const starters = [
  { icon: 'document', color: 'peach', title: '梳理信息，让重点浮现', description: '文档总结 · 信息提炼', prompt: '请帮我总结一份文档，提炼重点、待办事项和关键结论。开始前先问我文档的路径和希望关注的内容。' },
  { icon: 'code', color: 'mint', title: '把灵感，变成可用的代码', description: '代码实现 · 问题排查', prompt: '请帮我实现一个功能。开始前先问我项目位置、功能目标和验收标准，再提出实现步骤。' },
  { icon: 'search', color: 'lavender', title: '带着问题，探索更多可能', description: '资料研究 · 方案对比', prompt: '请帮我做一次主题研究。先问我研究主题、时间范围和需要的输出格式；使用联网工具前先确认工具是否可用，并注明信息来源。' },
];

export const panelNames = { runtime: '任务详情', memory: '记忆空间', agents: 'Agent 协作', schedules: '自动化', graph: '知识图谱', mcp: '工具连接', config: '模型与设置' };

export function statusLabel(status) {
  return ({ idle: '就绪', running: '执行中', completed: '已完成', failed: '失败', error: '出现错误', stopped: '已停止' })[status] || status;
}

export const orbit = `<svg class="orbit-art" viewBox="0 0 430 260" fill="none" aria-hidden="true">
  <defs><linearGradient id="orbit-fill" x1="140" y1="80" x2="270" y2="210" gradientUnits="userSpaceOnUse"><stop stop-color="#c0f2d7"/><stop offset="1" stop-color="#55b794"/></linearGradient><filter id="orbit-shadow" x="-60%" y="-60%" width="220%" height="220%"><feDropShadow dx="0" dy="12" stdDeviation="12" flood-color="#235442" flood-opacity=".12"/></filter></defs>
  <ellipse cx="220" cy="134" rx="176" ry="78" transform="rotate(-24 220 134)" stroke="#c6d5c8" stroke-dasharray="3 6"/>
  <ellipse cx="220" cy="134" rx="128" ry="61" transform="rotate(28 220 134)" stroke="#aec7b8"/>
  <ellipse cx="220" cy="134" rx="85" ry="98" transform="rotate(-25 220 134)" stroke="#d4ded1"/>
  <g filter="url(#orbit-shadow)"><rect x="169" y="83" width="102" height="102" rx="31" fill="url(#orbit-fill)" transform="rotate(-12 220 134)"/><path d="m220 105 7 20 21 9-21 8-7 21-8-21-20-8 20-9Z" fill="#fff"/><circle cx="245" cy="108" r="3" fill="#fff"/></g>
  <circle cx="64" cy="170" r="6" fill="#ed977d"/><circle cx="365" cy="86" r="5" fill="#4c987c"/><circle cx="318" cy="203" r="4" fill="#b3a2d1"/>
  <g transform="translate(55 63) rotate(-7)"><rect width="108" height="38" rx="12" fill="white" stroke="#e2e9df"/><circle cx="19" cy="19" r="9" fill="#e6f4ec"/><path d="m15 19 3 3 5-6" stroke="#418769" stroke-width="1.5"/><text x="36" y="23" fill="#566b5e" font-size="11" font-family="sans-serif">理解你的目标</text></g>
  <g transform="translate(272 172) rotate(5)"><rect width="110" height="38" rx="12" fill="white" stroke="#e2e9df"/><circle cx="19" cy="19" r="9" fill="#fff0e7"/><path d="m19 13 2 4 4 2-4 2-2 4-2-4-4-2 4-2Z" fill="#d48d6d"/><text x="35" y="23" fill="#566b5e" font-size="11" font-family="sans-serif">连接无限可能</text></g>
</svg>`;
