"""
============================================================
P1–P4 一句话（先记这个，再写代码）
------------------------------------------------------------
P1 契约骨架：状态机 + 命令 + 端口 + stub，内存里跑通闭环
P2 可恢复：同一套命令，落到 SQLite，重启不丢、revision 防乱写
P3 真证据：上传 CSV/PNG → 证据分层 → 组装 Context Package
P4 产品壳：网页只读 Project 投影、发命令，不另建聊天库
============================================================

文档对应：
  P1 docs/spec/contract-skeleton.md
  P2 docs/spec/runtime-recovery.md
  P3 docs/spec/context-evidence-baseline.md
  P4 docs/spec/product-shell-stub-flow.md

本文件练的是「P1 主流程」。P2/P3/P4 是在这根绳子上加能力，不是另起一套。

怎么跑（仓库根目录）：
  $env:PYTHONPATH = "src"
  python lab30min/my_main.py

学习建议：
  1) 先原样跑通，看打印
  2) 把 main() 里 lab.xxx() 全删掉，对着下面注释自己重写一遍再跑
"""

from __future__ import annotations

from simple_lab import Lab


def main() -> None:
    lab = Lab(project_id="handwritten")

    # 1. 创建项目
    print("1 create      ->", lab.create("Handwritten Demo"))

    # 2. 准备上下文（假材料；真上传是 P3）
    print("2 prepare     ->", lab.prepare("讲清楚 OEYdesign 是什么"))

    # 3. 生成候选（Design stub）
    ids = lab.generate(count=3)
    print("3 generate    ->", ids)

    # 4. 批准第 0 个方向（可改成 1 或 2 试试）
    print("4 approve     ->", lab.approve_direction(0))

    # 5. 生产 Artifact（Artifact stub）
    print("5 produce     ->", lab.produce("web"))

    # 6. 质检（Quality stub）
    print("6 validate    ->", lab.validate())

    # 7. 批准导出
    print("7 export ok   ->", lab.approve_export())

    # 8. 交付
    print("8 deliver     ->", lab.deliver())

    # 复盘
    print()
    lab.summary()


if __name__ == "__main__":
    main()
