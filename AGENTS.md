<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# 유저 친화적 UI 개선 트리거 (필독)

사용자가 **"유저 친화적으로 개선", "너무 복잡하다", "이해가 안 된다", "전문용어 많다", "직관적이지 않다", "가독성"** 등 UX 단순화·개선을 요구하면, **작업 착수 전 반드시 `claude-ux.md`를 먼저 읽고** 그 원칙(결론 먼저·근거 접기, 여정=질문, 칸반 그룹핑, 평어 질문 라벨, 판정 모순 방지, grid 균등 정렬, 상세 문서 탈출구, 통계적 정직성)대로 진행한다. 수학 엔진(`src/utils/*Math.js`)은 절대 건드리지 않고 렌더층만 재구성.
