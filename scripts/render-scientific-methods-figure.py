"""Render one source-bound quantitative figure for the existing technical report."""
import hashlib
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'research/test_results/scientific-methods-results.json'
DATA = json.loads(SOURCE.read_text(encoding='utf-8'))
OUT = ROOT / 'docs/figures'
OUT.mkdir(exist_ok=True)
plt.rcParams.update({'font.family': 'sans-serif', 'font.sans-serif': ['Microsoft YaHei', 'SimHei', 'Arial'],
                     'font.size': 11, 'axes.spines.top': False, 'axes.spines.right': False,
                     'axes.linewidth': 0.8, 'legend.frameon': False, 'pdf.fonttype': 42,
                     'svg.fonttype': 'none', 'axes.unicode_minus': False})
fig, axes = plt.subplots(1, 2, figsize=(11.4, 4.1), constrained_layout=True)
blocks = DATA['time_block_input']['services'][0]['time_blocks']
demand = [b['demand_visits']['value'] for b in blocks]
capacity = [b['capacity_per_slot']['value'] * b['slots']['value'] for b in blocks]
served = [min(d, k) for d, k in zip(demand, capacity)]
x = np.arange(len(blocks))
for shift, numbers, label, color in [(-0.25, demand, '需求', '#B64342'), (0, capacity, '容量', '#CFCECE'), (0.25, served, '实际可服务', '#0F4D92')]:
    bars = axes[0].bar(x + shift, numbers, width=0.24, label=label, color=color, edgecolor='#4D4D4D', linewidth=0.4)
    axes[0].bar_label(bars, padding=3, fontsize=10)
axes[0].set_xticks(x, [b['name'] for b in blocks])
axes[0].set_xlabel('同一月份内的两个时段')
axes[0].set_ylabel('服务需求与容量（人次）')
axes[0].set_ylim(0, 103)
axes[0].set_yticks([0, 20, 40, 60, 80, 100])
axes[0].legend(ncol=3, fontsize=10, loc='upper center')
axes[0].text(0.01, 1.03, 'a  分时核算：服务70，月合计上限100', transform=axes[0].transAxes, weight='bold')
sweep = DATA['demand_sweep']
axes[1].plot([row['demand_visits'] for row in sweep], [row['cash_balance'] for row in sweep], color='#0F4D92', linewidth=2)
axes[1].axhline(0, color='#767676', linewidth=0.9, linestyle='--')
axes[1].axvline(520, color='#767676', linewidth=0.9, linestyle=':')
axes[1].scatter([400, 500, 520], [-200, 0, 40], color=['#B64342', '#272727', '#42949E'], s=28, zorder=5)
axes[1].annotate('基准400人次：−200元', (400, -200), xytext=(90, -470), arrowprops={'arrowstyle': '-', 'color': '#767676'}, fontsize=10)
axes[1].annotate('收支平衡：500人次', (500, 0), xytext=(130, 360), arrowprops={'arrowstyle': '-', 'color': '#767676'}, fontsize=10)
axes[1].annotate('月容量520人次\n满负荷结余40元', (520, 40), xytext=(545, -650), arrowprops={'arrowstyle': '-', 'color': '#767676'}, fontsize=10)
axes[1].set_xlim(0, 710)
axes[1].set_ylim(-1100, 550)
axes[1].set_xlabel('月需求（人次）')
axes[1].set_ylabel('运营现金结余（元/月）')
axes[1].text(0.01, 1.03, 'b  给定收费与支出下的容量约束', transform=axes[1].transAxes, weight='bold')
for extension in ['pdf', 'svg', 'png']:
    fig.savefig(OUT / f'operations-scientific-checks.{extension}', dpi=200)
plt.close(fig)
receipt = {'source': str(SOURCE.relative_to(ROOT)), 'source_sha256': hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
           'generator': 'scripts/render-scientific-methods-figure.py', 'data_kind': 'explicit_demonstration',
           'panels': ['two time blocks: 70 served vs 100 pooled', 'cash balance by demand with capacity 520'],
           'outputs': {extension: hashlib.sha256((OUT / f'operations-scientific-checks.{extension}').read_bytes()).hexdigest() for extension in ['pdf', 'svg', 'png']}}
(OUT / 'operations-scientific-checks.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps(receipt, ensure_ascii=False))
