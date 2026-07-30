"""给实验用的极简外壳：把 ControlPlane 藏起来，你只记「下一步叫什么」。"""

from __future__ import annotations

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


class Lab:
    """假装这是你的应用入口。内部仍是 P1 的 ControlPlane + stub。"""

    def __init__(self, project_id: str = "my_lab") -> None:
        self.cp = ControlPlane()
        self.project_id = project_id

    def _send(self, command_type, command_id: str, **kwargs):
        project = self.cp.repository.get(self.project_id)
        return self.cp.execute(
            command_type(
                command_id=command_id,
                project_id=self.project_id,
                expected_project_revision=project.revision,
                **kwargs,
            )
        )

    def create(self, name: str = "My Demo") -> str:
        """创建项目 → 状态进入 INGESTING。"""
        result = self.cp.execute(
            CreateProject(
                command_id="cmd-create",
                project_id=self.project_id,
                name=name,
                preset=ConstraintPreset.DESIGN_GUIDED,
                template_role=TemplateRole.REFERENCE_SAMPLE,
            )
        )
        return str(result.state)

    def prepare(self, goal: str = "Create a launch story") -> str:
        """塞最小 Context（P1 假材料；真上传是 P3）→ READY_FOR_DESIGN。"""
        result = self._send(
            PrepareProject,
            "cmd-prepare",
            context_package=ContextPackage(
                id=stable_id("context", self.project_id, 1),
                project_id=self.project_id,
                revision=1,
                confirmed_facts=("fact from lab",),
                source_refs=("source:lab",),
            ),
            brief=DesignBrief(goal, "Product leaders", "web"),
        )
        return str(result.state)

    def generate(self, count: int = 3) -> list[str]:
        """Design stub 出候选 → AWAITING_DIRECTION_APPROVAL。返回候选 id 列表。"""
        result = self._send(
            GenerateCandidates, "cmd-generate", candidate_count=count
        )
        self._candidates = list(result.value)
        print("状态:", result.state)
        return [c.id for c in self._candidates]

    def approve_direction(self, index: int = 0) -> str:
        """批准第 index 个候选。"""
        chosen = self._candidates[index]
        result = self._send(
            ApproveDirection,
            "cmd-approve-direction",
            candidate_id=chosen.id,
            candidate_revision=chosen.revision,
        )
        return str(result.state)

    def produce(self, medium: str = "web") -> str:
        """Artifact stub 产生产物。返回 artifact id。"""
        result = self._send(ProduceArtifact, "cmd-produce", medium=medium)
        self._artifact = result.value
        print("状态:", result.state)
        return self._artifact.id

    def validate(self) -> str:
        """Quality stub 质检。"""
        result = self._send(
            ValidateArtifact, "cmd-validate", render_profile={"width": 1440}
        )
        print("硬错误:", result.value.hard_errors)
        return str(result.state)

    def approve_export(self) -> str:
        """批准导出。"""
        result = self._send(
            ApproveExport,
            "cmd-approve-export",
            artifact_id=self._artifact.id,
            artifact_revision=self._artifact.revision,
        )
        return str(result.state)

    def deliver(self) -> str:
        """交付 → DELIVERED。"""
        result = self._send(
            DeliverArtifact, "cmd-deliver", delivery_profile={"format": "zip"}
        )
        return str(result.state)

    def state_path(self) -> list[str]:
        """看看状态机走过哪些站。"""
        project = self.cp.repository.get(self.project_id)
        return [
            e.payload["to"]
            for e in project.events
            if e.event_type == "ProjectStateChanged"
        ]

    def summary(self) -> None:
        project = self.cp.repository.get(self.project_id)
        print("最终状态:", project.state)
        print("revision:", project.revision)
        print("路径:")
        for step in self.state_path():
            print(" ", step)
