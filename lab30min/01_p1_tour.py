"""
Lab 1 — 理解 Phase 1：契约骨架

怎么用（按顺序）：
1. 在 Cursor 里打开本文件，从上往下读注释（别急着跑）。
2. 按「课前阅读」去源码里点开对应文件，对照看。
3. 读完后，在仓库根目录只跑一条命令：

   $env:PYTHONPATH = "src"
   python lab30min/01_p1_tour.py

4. 看终端打印，再回来改「动手题」里那一行，重跑一次。
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# 课前阅读（先在编辑器里打开，别跑代码）
#
# A. src/oeydesign/domain.py
#    搜：class ProjectState
#    问自己：一个设计项目会经历哪些状态？这是「产品语言」。
#
# B. src/oeydesign/ports.py
#    搜：class DesignIntelligencePort
#    问自己：这里只有方法签名，没有实现。为什么？
#    答：端口 = 可替换接缝。真正干活的可以是 stub，以后换成真模型。
#
# C. src/oeydesign/stubs.py
#    搜：class DeterministicDesignPort
#    问自己：没接 LLM，它怎么「设计」？答：按规则编造确定性候选。
#
# D. src/oeydesign/control.py
#    文件头注释写着：Control Plane 是 Project 业务状态的「唯一写手」。
#    P1 最重要的工程判断：聊天、UI、模型都不能直接改 Project，只能发 Command。
# ---------------------------------------------------------------------------

from oeydesign import (
    ApproveDirection,
    ApproveExport,
    ConstraintPreset,
    ContextPackage,
    ControlPlane,
    CreateProject,
    DeliverArtifact,
    DesignBrief,
    GenerateCandidates,
    PrepareProject,
    ProduceArtifact,
    TemplateRole,
    ValidateArtifact,
    stable_id,
)


def show(title: str, value: object) -> None:
    print(f"\n=== {title} ===")
    print(value)


def main() -> None:
    # ControlPlane = 指挥官。默认自带：内存仓库 + 四个确定性 stub。
    # 这一步没有数据库、没有网页、没有模型。纯 P1。
    cp = ControlPlane()
    project_id = "lab_p1"

    # --- 步骤 1：创建项目 -----------------------------------------------
    # CreateProject 是一条「命令」。命令会带着 command_id（幂等/审计用）。
    result = cp.execute(
        CreateProject(
            command_id="01-create",
            project_id=project_id,
            name="Lab Demo",
            preset=ConstraintPreset.DESIGN_GUIDED,
            template_role=TemplateRole.REFERENCE_SAMPLE,
        )
    )
    show("1 创建后的状态", result.state)
    # 预期：INGESTING（正在接收/准备材料）

    # --- 步骤 2：塞进 Context（P1 还没有真上传，手写一个包裹）----------
    # 注意 expected_project_revision：必须等于当前项目 revision。
    # 这是防「用旧页面点按钮」把状态写乱的保险丝（P2 会更强调）。
    project = cp.repository.get(project_id)
    result = cp.execute(
        PrepareProject(
            command_id="02-prepare",
            project_id=project_id,
            expected_project_revision=project.revision,
            context_package=ContextPackage(
                id=stable_id("context", project_id, 1),
                project_id=project_id,
                revision=1,
                confirmed_facts=("OEYdesign is a design workspace.",),
                source_refs=("source:brief",),
            ),
            brief=DesignBrief("Create a launch story", "Product leaders", "web"),
        )
    )
    show("2 准备后的状态", result.state)
    # 预期：READY_FOR_DESIGN

    # --- 步骤 3：生成候选（调用 Design 端口 → 实际是 stub）--------------
    project = cp.repository.get(project_id)
    result = cp.execute(
        GenerateCandidates(
            command_id="03-generate",
            project_id=project_id,
            expected_project_revision=project.revision,
            candidate_count=3,
        )
    )
    candidates = result.value
    show("3 状态", result.state)
    show("3 候选 id 列表", [c.id for c in candidates])
    # 预期：AWAITING_DIRECTION_APPROVAL，以及 3 个候选 id

    # --- 步骤 4～8：批准方向 → 产物 → 质检 → 导出审批 → 交付 ----------
    # 下面用一个小帮手，避免每次手抄 revision。
    def send(command_type, command_id: str, **kwargs):
        current = cp.repository.get(project_id)
        return cp.execute(
            command_type(
                command_id=command_id,
                project_id=project_id,
                expected_project_revision=current.revision,
                **kwargs,
            )
        )

    chosen = candidates[0]  # 动手题：改成 candidates[1] 再跑，看交付是否还成功
    result = send(
        ApproveDirection,
        "04-approve",
        candidate_id=chosen.id,
        candidate_revision=chosen.revision,
    )
    show("4 批准方向后", result.state)

    result = send(ProduceArtifact, "05-produce", medium="web")
    artifact = result.value
    show("5 产物后", f"{result.state} / artifact={artifact.id}")

    result = send(ValidateArtifact, "06-validate", render_profile={"width": 1440})
    show("6 质检后", f"{result.state} / hard_errors={result.value.hard_errors}")

    result = send(
        ApproveExport,
        "07-export",
        artifact_id=artifact.id,
        artifact_revision=artifact.revision,
    )
    show("7 导出审批后", result.state)

    result = send(DeliverArtifact, "08-deliver", delivery_profile={"format": "zip"})
    show("8 交付后", result.state)
    # 预期：DELIVERED

    # --- 复盘：状态机走过的路 ------------------------------------------
    # 事件是 Project 自己记的「发生过什么」。UI 以后也该读这个，而不是读聊天。
    project = cp.repository.get(project_id)
    path = [
        event.payload["to"]
        for event in project.events
        if event.event_type == "ProjectStateChanged"
    ]
    show("整条状态路径", "\n".join(path))

    print(
        """
------------------------------------------------
你刚才验证的是 P1 退出条件的核心：
  创建 → 候选 → 批准 → Artifact → QA → 交付
全程没有真模型、没有真渲染器——stub 就够证明「契约成立」。

动手题（改代码，别只改终端）：
  1) 把 chosen = candidates[0] 改成 candidates[1]，重跑，交付还成功吗？
  2) 把 candidate_count=3 改成 1，重跑，候选列表变短了吗？
改完保存，再执行同一条 python 命令即可。
------------------------------------------------
"""
    )


if __name__ == "__main__":
    main()
