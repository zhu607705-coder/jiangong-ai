"""Render the existing synthetic calculations as a readable Nature-style composite."""
import hashlib
import json
import warnings
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sources = [ROOT / 'data/templates/complete-community-demo-v1.json',
           ROOT / 'research/test_results/complete-community-demo-calculations.json',
           ROOT / 'packages/retrofit/analysis-palette.json']
demo, calculations, colors = [json.loads(path.read_text(encoding='utf-8')) for path in sources]
assert demo['kind'] == calculations['data_kind'] == 'synthetic'
before = [row['value'] for row in demo['beforeDashboard']['dimensions']]
after = [row['value'] for row in demo['afterDashboard']['dimensions']]
labels = [row['label'] for row in demo['dimensions']]
metrics = [row['result']['metrics'] for row in calculations['scenarios']]
served = [row['served_visits'] for row in metrics]
cash = [row['balance_after_support'] for row in metrics]
daily = [sum(row['date'] == f'2026-09-{day:02}' for row in demo['ledger']) for day in range(1, 31)]
unique = len({row['resident_id'] for row in demo['ledger']})
assert served == [1304, 1630, 1956] and cash == [1035, 2294, 3553]
assert sum(daily) == len(demo['ledger']) == 1568 and unique == 286
assert all(row['government_outlay'] == 19000 for row in metrics)

warnings.filterwarnings('error', message='Glyph .* missing')
plt.rcParams.update({'font.family': 'sans-serif', 'font.sans-serif': ['Microsoft YaHei', 'Arial', 'DejaVu Sans'],
                     'font.size': 10.5, 'axes.spines.top': False, 'axes.spines.right': False,
                     'axes.linewidth': .8, 'legend.frameon': False, 'pdf.fonttype': 42,
                     'svg.fonttype': 'none', 'axes.unicode_minus': False,
                     'text.color': colors['ink'], 'axes.labelcolor': colors['ink'],
                     'xtick.color': colors['muted'], 'ytick.color': colors['muted']})
fig, axes = plt.subplots(2, 2, figsize=(7.1, 5.8))
fig.subplots_adjust(left=.12, right=.98, bottom=.1, top=.93, wspace=.4, hspace=.58)
for ax, panel in zip(axes.flat, ['a', 'b', 'c', 'd']):
    ax.text(-.14, 1.08, panel, transform=ax.transAxes, fontsize=12, weight='bold')
    ax.tick_params(length=3, width=.7)

a = axes[0, 0]
y = np.arange(len(labels))
a.hlines(y, before, after, color=colors['reference'], linewidth=2)
a.scatter(before, y, edgecolor=colors['red'], facecolor='white', s=27, label='改造前', zorder=3)
a.scatter(after, y, color=colors['blue'], marker='s', s=25, label='拟方案', zorder=3)
for yy, lo, hi in zip(y, before, after):
    a.text(lo - .13, yy, f'{lo:.1f}', ha='right', va='center', fontsize=10)
    a.text(hi + .13, yy, f'{hi:.1f}', ha='left', va='center', fontsize=10)
a.set_yticks(y, labels)
a.set_ylim(5.6, -.6)
a.set_xlim(1, 5.55)
a.set_xticks([1, 2, 3, 4, 5])
a.set_xlabel('条件覆盖度 / 级')
a.set_ylabel('业务维度')
a.legend(loc='lower left', bbox_to_anchor=(0, 1.04), ncol=2, fontsize=10, handletextpad=.35)

scenario_labels = ['保守', '基准', '积极']
scenario_colors = [colors['reference'], colors['blue'], colors['teal']]
b = axes[0, 1]
bars = b.bar(scenario_labels, served, width=.58, color=scenario_colors,
             edgecolor=colors['muted'], linewidth=.6, hatch=['//', '', '...'])
b.bar_label(bars, labels=[f'{value:,}' for value in served], padding=4, fontsize=10)
b.axhline(2044, color=colors['red'], linestyle='--', linewidth=1)
b.text(.02, .97, '独立资源容量 2,044', transform=b.transAxes, va='top', fontsize=10, color=colors['red'])
b.set_ylim(0, 2500)
b.set_yticks([0, 1000, 2000])
b.set_xlabel('固定需求情景')
b.set_ylabel('服务量 / 人次每月')

c = axes[1, 0]
bars = c.bar(scenario_labels, cash, width=.58, color=scenario_colors,
             edgecolor=colors['muted'], linewidth=.6, hatch=['//', '', '...'])
c.bar_label(bars, labels=[f'{value:,}' for value in cash], padding=4, fontsize=10)
c.set_ylim(0, 4300)
c.set_yticks([0, 1000, 2000, 3000, 4000])
c.set_xlabel('固定需求情景')
c.set_ylabel('支持后现金结余 / 元每月')
c.text(.02, 1.04, '政府投入均为19,000元/月；直付另账', transform=c.transAxes, fontsize=10)

d = axes[1, 1]
days = np.arange(1, 31)
d.plot(days, daily, color=colors['blue'], linewidth=1.3, marker='o', markersize=3,
       markerfacecolor='white', markeredgewidth=.8)
d.scatter([30], [daily[-1]], color=colors['red'], s=25, zorder=4)
d.set_xlim(0, 31)
d.set_ylim(0, 65)
d.set_xticks([1, 10, 20, 30], ['9/1', '9/10', '9/20', '9/30'])
d.set_yticks([0, 20, 40, 60])
d.set_xlabel('2026年9月 / 日期')
d.set_ylabel('服务记录 / 人次每天')
d.text(.02, 1.04, '整月1,568人次，跨服务去重286人', transform=d.transAxes, fontsize=10)

output = ROOT / 'docs/figures/community-analysis-figure.pdf'
fig.savefig(output, dpi=300)
plt.close(fig)
receipt = {
    'data_kind': 'synthetic', 'generator': 'scripts/render-community-analysis-figure.py',
    'source_hashes': {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sources},
    'formal_resamples': 0, 'seed_policy': 'deterministic, no random sampling',
    'panels': {'a': {'before': before, 'after': after}, 'b': {'served': served, 'capacity': 2044},
               'c': {'cash': cash, 'government_outlay': 19000},
               'd': {'daily_visits': daily, 'total_visits': sum(daily), 'monthly_unique': unique}},
    'output': str(output.relative_to(ROOT)), 'sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
}
(ROOT / 'docs/figures/community-analysis-figure.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps(receipt, ensure_ascii=False))
