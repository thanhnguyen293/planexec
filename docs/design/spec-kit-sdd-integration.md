# Design: tích hợp planexec + spec-kit + subagent-driven-development

**Trạng thái:** Draft (chờ duyệt) · **Nhánh:** `feat/spec-kit-sdd-integration`
**Ngày:** 2026-07-13

> Tài liệu này chỉ là thiết kế. Chưa sửa code. Duyệt xong mới build.

---

## 1. Mục tiêu

Ghép ba thứ thành **một pipeline duy nhất** thay vì ba workflow rời:

- **planexec** (repo này) — strong-planner / cheap-executor, human gates, "planner
  không đụng code + tự verify độc lập".
- **[spec-kit](https://github.com/github/spec-kit)** — spec-driven development:
  `constitution → specify → clarify → plan → tasks → implement`.
- **subagent-driven-development (SDD)** của
  [superpowers](https://github.com/obra/superpowers) — engine thực thi: 1
  implementer subagent **mỗi task** + task-review + fix-loop + whole-branch review.

**Không mục tiêu:** thay thế bất kỳ cái nào bằng cái khác; viết lại spec-kit hay
superpowers; hỗ trợ đầy đủ cả 3 tool (Claude/OpenCode/Codex) ngay từ đầu.

---

## 2. Luận điểm trung tâm

Ba hệ thống **không cạnh tranh** — chúng phủ ba đoạn khác nhau của cùng một dây
chuyền. planexec hiện ôm cả dây chuyền nhưng "mỏng" ở hai đầu; spec-kit làm dày
đầu trước, SDD làm dày đầu sau. planexec giữ phần **governance** ở giữa (thứ mà
hai cái kia không có).

| Đoạn | planexec hiện tại | Bổ sung | Vì sao |
|---|---|---|---|
| **Upstream** — constitution, spec, clarify, plan, tasks | Step 1–3 (Explore → Clarify → High-level plan) | **spec-kit** | Có `constitution.md` (nguyên tắc dự án bền vững) + artifact có cấu trúc trong `specs/NNN/`; giàu hơn hẳn 3 step đầu |
| **Governance** — model split, human gates, planner-verifier | Toàn bộ triết lý planexec | *giữ nguyên* | Giá trị lõi 2 cái kia thiếu: gate phê duyệt + planner độc lập verify |
| **Downstream** — thực thi + review | Step 5 (1 executor/phase, planner verify cuối) | **SDD** | Per-task review + fix-loop + whole-branch review — planexec hiện chỉ verify 1 lần ở cuối |

---

## 3. Kiến trúc tích hợp

```
spec-kit (upstream)      planexec (governance)          SDD (execution engine)
───────────────────      ─────────────────────          ──────────────────────
constitution.md ──┐
/speckit.specify  │
/speckit.clarify  ├──→ [GATE 1: duyệt spec/tasks]
/speckit.plan     │
/speckit.tasks ───┘
     (specs/NNN/) │
                  └──→ planner (strong) viết plan-file
                       (executor-plan format + SDD task contract)
                            │
                            └──→ [GATE 2: Dispatch / Modify / Cancel]  ← gate cuối cùng
                                     │
                                     └──→ SDD chạy continuous:
                                          per-task implementer → task-review
                                          → fix → … → whole-branch review
                                              │
                                              └──→ planner verify độc lập (git diff)
                                                   → summary → bạn merge
```

**Nguyên tắc ranh giới gate:** mọi human checkpoint nằm **trước lúc code chạy**
(duyệt spec + duyệt plan). Sau GATE 2, SDD chạy autonomous. Giữ được kỷ luật
"review trước khi tốn tiền" của planexec **và** autonomy của SDD.

---

## 4. Điểm va chạm #1 — hai triết lý execution (quan trọng nhất)

Đây là mâu thuẫn kiến trúc thật, không phải chuyện format:

| | **executor-plan (planexec)** | **SDD (superpowers)** |
|---|---|---|
| Quan niệm executor | "Cheap models giỏi làm theo, dở suy luận. Executor **không được quyết gì**." | Implementer là **kỹ sư có năng lực** làm từ brief, được hỏi (`NEEDS_CONTEXT`) |
| Nội dung plan | **Code viết sẵn** trong plan, executor chỉ copy + wire | Task **spec/brief**, implementer tự viết code |
| Model | cheap cố định | **model-per-dispatch** (cheap cho task cơ học, capable cho integration/debug) |
| TDD | Không ép TDD cho file UI/declarative | Nghiêng về TDD (chuẩn superpowers) |
| Review giữa chừng | Không (chỉ planner verify cuối) | **task-review sau mỗi task** + fix-loop |

Hai lựa chọn tích hợp:

### Phương án A — "SDD wrapper, giữ executor copyist" ⭐ khuyến nghị
Giữ nguyên triết lý executor-plan (plan chốt mọi thứ, code viết sẵn), nhưng
**bọc** execution bằng kiến trúc review của SDD:

- executor cũ vẫn là implementer, nhưng thêm **task-review subagent sau mỗi
  step/phase** (spec-compliance + code-quality) + **fix-loop**.
- planner verify cuối = whole-branch review của SDD (đã có sẵn, chỉ đổi tên).
- Model-per-dispatch của SDD trở thành bản tinh chỉnh của "strong/cheap" nhị phân.

**Được:** rủi ro thấp, giữ nguyên giá trị planexec, chỉ *thêm* review gate giữa
chừng (thứ đang thiếu). **Mất:** không tận dụng "implementer thông minh" của SDD.

### Phương án B — "SDD thay executor hoàn toàn"
Bỏ executor copyist; plan-file chuyển từ "code viết sẵn" sang "brief + Global
Constraints"; implementer subagent của SDD tự viết code.

**Được:** đúng tinh thần SDD, plan ngắn hơn, linh hoạt hơn. **Mất:** phá vỡ core
principle của `executor-plan` skill; mất tính "executor không quyết gì" — đúng thứ
planexec dựng lên để dùng model rẻ an toàn.

> **Khuyến nghị: Phương án A.** Nó cộng hưởng thay vì thay thế: planexec đóng góp
> "plan chốt mọi thứ + cheap executor", SDD đóng góp "review + fix-loop giữa chừng"
> — đúng lỗ hổng của planexec. B để dành nếu sau này muốn nới sang implementer mạnh.

---

## 5. Điểm va chạm #2 — hợp đồng plan-file (artifact)

✅ **Đã kiểm chứng Phase 0** (đọc source thật của cả hai repo — xem §13).

Ba hệ dùng **ba quy ước "đơn vị task" khác nhau** — đây là điểm va chạm thật:

| Hệ | Quy ước đơn vị | Ví dụ |
|---|---|---|
| spec-kit `tasks.md` | item checklist, gom dưới `## Phase N` | `- [ ] T001 [P] [US1] Create model in src/...` |
| SDD `task-brief` | **heading** khớp regex `^#+[ \t]+Task[ \t]+N` | `## Task 1`, `### Task 2` |
| executor-plan | heading `### Step N: <action> — <file>` | `### Step 1: add route — app/x.dart` |

**Ràng buộc cứng (verified):** `scripts/task-brief PLAN_FILE N` rút văn bản task
bằng cách quét **heading** `# Task N`/`## Task N`… (bỏ qua trong code fence). Nếu
plan-file không có heading dạng `Task N`, SDD **không rút được brief**. `executor`
hiện tại của planexec lại đánh số `Step N`. → Đây là điểm phải hợp nhất, không né
được.

**Giải pháp: một plan-file chuẩn thỏa cả ba** —

1. `specs/NNN/` của spec-kit là **nguồn spec/plan gốc** (source of truth).
2. planner (Step 4) sinh plan-file với **heading `## Task N`** (để `task-brief`
   rút được), nội dung mỗi task theo **executor-plan** (current state + pre-written
   code + exemplar + verify+expected), cộng section **`## Global Constraints`** ở
   đầu (SDD đọc làm "attention lens", cũng là nơi nhét constitution).
3. Adapter `tasks.md (T001…) → plan-file (## Task N)` là **quy ước viết trong
   `planner.md`**, không cần script.

Skeleton plan-file hợp nhất:

```markdown
# Plan: <ticket-id> — <short name>

## Global Constraints        ← SDD reviewer đọc; nhồi constitution + exact values
- <binding requirement, exact values, quan hệ component>
- NO refactoring/renaming ngoài plan · NO edits ngoài file liệt kê
- Near-miss (KHÔNG đụng): <file nhìn giống nhưng không liên quan>
- Escape hatch: <điều kiện> → stop, report blocker

## Task 1: <action> — `<file path>`     ← heading "Task N" để task-brief rút được
- Current state (line ~n): ```<current excerpt>```
- Replace with: ```<pre-written code>```
- Convention exemplar: `<exemplar file>`
- Verify: `<command>` → expected: <output/exit code>

## Task 2: <test for Task 1> — `<test file>`
...

## Final verification
- `<command>` → <expected output>
```

**Cơ chế file-handoff của SDD (verified):** artifacts nằm ở
`<repo-root>/.superpowers/sdd/` (script `sdd-workspace` tạo + tự `.gitignore`):
`task-N-brief.md`, `task-N-report.md`, `review-<base7>..<head7>.diff`, và **progress
ledger** `progress.md` (bản đồ hồi phục sau compaction — planexec hiện chưa có).
`review-package BASE HEAD` dùng `git diff -U10 BASE..HEAD`, BASE = commit ghi lại
TRƯỚC khi dispatch implementer (không phải `HEAD~1`).

---

## 6. constitution → planner → Global Constraints

`constitution.md` của spec-kit (`.specify/memory/constitution.md`) là mảnh
planexec đang thiếu: nguyên tắc dự án bền vững (code quality, testing, UX,
performance). Đưa nó vào:

- **planner context** (Step 1–4): planner đọc constitution để đề xuất Approach
  và Change Map bám nguyên tắc dự án.
- **SDD Global Constraints**: bơm constitution vào phần Global Constraints mà mỗi
  subagent (implementer + reviewer) nhận, làm "attention lens" khi review.

---

## 7. Mapping lệnh spec-kit ↔ step planexec

| spec-kit | planexec step | Ghi chú |
|---|---|---|
| `/speckit.constitution` | *(mới)* nạp constitution làm context | Chạy 1 lần/dự án |
| `/speckit.specify` | Step 1 Explore (mở rộng thành spec.md) | spec = "what", chưa "how" |
| `/speckit.clarify` | Step 2 Clarify | Trùng vai trò — hợp nhất |
| `/speckit.plan` | Step 3 High-level plan | GATE 1 nằm ở đây |
| `/speckit.tasks` | đầu vào cho Step 4 | tasks.md → plan-file |
| `/speckit.analyze` | Step 4 (kiểm tra nhất quán trước Dispatch) | pre-flight scan của SDD làm luôn |
| `/speckit.implement` | Step 5 Execute | **thay bằng SDD engine** |
| — | Step 5 Verify | planner verify = whole-branch review |

Câu hỏi mở: chạy các lệnh `/speckit.*` **native** (gọi thẳng spec-kit) hay
**tái hiện** logic của chúng trong `planner.md`? Xem §10.

---

## 8. Độ phủ tool

| Tool | spec-kit | superpowers-SDD | Đánh giá |
|---|---|---|---|
| **Claude Code** | ✅ | ✅ (mạnh nhất, cần plugin + scripts) | **Làm trước** — flow ghép sạch nhất |
| OpenCode | ✅ | ✅ | Port sau |
| Codex CLI | ✅ | ✅ | Port sau, nhiều ràng buộc nhất |

→ Đề xuất: **Claude Code first**. Sau khi ổn mới port sang OpenCode/Codex (giữ
đúng pattern "OpenCode là bản gốc, còn lại là port" hiện tại — hoặc đảo lại nếu
Claude Code trở thành nơi flow ghép hoàn chỉnh nhất).

---

## 9. Phụ thuộc mới

- **spec-kit** phải được cài (`uvx --from git+... specify init` hoặc tương đương)
  → thư mục `.specify/` + lệnh `/speckit.*`.
- **superpowers plugin** phải được cài (cho SDD skill + `scripts/`).
- README §"After installing" phải cập nhật: writing-plans *và* SDD *và* spec-kit
  là điều kiện tiên quyết cho flow đầy đủ.

---

## 10. Quyết định mở (cần bạn chốt trước khi build)

1. **Triết lý execution:** Phương án A (wrapper, giữ copyist) hay B (SDD thay
   hẳn)? → doc khuyến nghị **A**.
2. ~~**spec-kit native hay tái hiện**~~ → **ĐÃ CHỐT: Native `/speckit.*`**
   (2026-07-13). spec-kit là dependency thật; user chạy chuỗi `/speckit.*` để đẻ
   `specs/NNN/`, `/planner` tiếp quản **từ `tasks.md`** và **bỏ qua
   `/speckit.implement`** (SDD engine thay thế). Xem §14.
3. **Phạm vi bản đầu:** chỉ Claude Code, hay cả 3 tool?
4. **Vị trí gate:** giữ đúng 2 gate như §3, hay thêm gate sau spec (`specify`)?
5. ~~**Quan hệ với executor cũ**~~ → **ĐÃ CHỐT: giữ** (2026-07-13). Trên Claude
   Code path `executor.md` bị **bypass** (SDD dùng `implementer-prompt.md` của
   nó); `executor.md` vẫn là executor cho OpenCode/Codex (Phase 4) + fallback tài
   liệu. Không xóa.

---

## 11. Lộ trình đề xuất (sau khi chốt §10)

1. **Phase 0** — kiểm chứng cơ chế: cài spec-kit + superpowers thật, xác nhận
   `task-brief` / `review-package` / section-header (§5 ⚠️).
2. **Phase 1** — Claude Code: mở rộng `planner.md` để (a) nạp constitution, (b)
   sinh spec/tasks kiểu spec-kit ở Step 1–3, (c) Step 4 xuất plan-file chuẩn §5.
3. **Phase 2** — thay Step 5 bằng SDD engine (Phương án A): thêm task-review +
   fix-loop quanh executor; planner giữ whole-branch verify.
4. **Phase 3** — cập nhật `install.sh` + README + skill `executor-plan` cho hợp
   đồng plan-file mới.
5. **Phase 4** — port OpenCode / Codex.

---

## 12. Rủi ro

- **Phụ thuộc chồng:** flow đầy đủ cần spec-kit + superpowers + writing-plans cài
  đúng; hỏng 1 mắt xích là gãy. → tài liệu hoá rõ, và giữ chế độ "planexec thuần"
  chạy được khi thiếu spec-kit/SDD.
- **Version drift:** spec-kit/superpowers đổi tên lệnh hoặc script → adapter gãy.
  → pin version / ghi rõ version đã test.
- **Mất bản sắc planexec:** nếu nghiêng quá về SDD (Phương án B) sẽ đánh mất
  "cheap executor không quyết gì". → chọn A giữ được bản sắc.
- **Trùng vai trò:** clarify/analyze/review xuất hiện ở cả ba → phải hợp nhất rõ
  (§7) kẻo chạy hai lần.

---

## 13. Phase 0 — kết quả kiểm chứng (2026-07-13)

Đọc source thật: `obra/superpowers` + `github/spec-kit` (clone shallow).

**SDD (superpowers) — verified:**
- `skills/subagent-driven-development/` có: `SKILL.md`, `implementer-prompt.md`,
  `task-reviewer-prompt.md`, và `scripts/{task-brief, review-package, sdd-workspace}`.
- `task-brief PLAN_FILE N [OUTFILE]` — awk quét heading `^#+[ \t]+Task[ \t]+N`,
  bỏ qua trong ```` ``` ```` fence. **Đơn vị task = heading `Task N`** (xác nhận
  ràng buộc §5).
- `review-package BASE HEAD [OUTFILE]` — ghi commit list + `git diff --stat` +
  `git diff -U10 BASE..HEAD` ra 1 file.
- `sdd-workspace` — `<root>/.superpowers/sdd/` + tự `.gitignore` (vì Claude Code
  chặn ghi vào `.git/`). Ledger: `.superpowers/sdd/progress.md`.
- Final review dùng `../requesting-code-review/code-reviewer.md`.
- SKILL yêu cầu skills: `using-git-worktrees`, `writing-plans`,
  `requesting-code-review`, `finishing-a-development-branch`; subagent dùng
  `test-driven-development` (⟶ TDD-leaning, xác nhận va chạm §4).
- Red flag: "Never start on main/master without consent" — khớp `ticket/<id>`
  branch của executor planexec.

**spec-kit — verified:**
- `templates/commands/`: `constitution, specify, clarify, plan, tasks, analyze,
  implement, converge, checklist, taskstoissues`. (Lệnh cài là `/speckit.<name>`.)
- `templates/`: `constitution-template.md, spec-template.md, plan-template.md,
  tasks-template.md, checklist-template.md`.
- `tasks-template.md` — task là item checklist `- [ ] T001 [P] [US1] … in path`,
  gom dưới `## Phase N: …`; tests **OPTIONAL** ("only if tests requested"). ⟶
  không tự đẻ heading `Task N`, nên **adapter là bắt buộc** (§5).
- `.specify/memory/constitution.md` là nơi ở của constitution.

**Kết luận Phase 0:** mọi giả định §5 xác nhận đúng; điểm cần hành động = **hợp
đồng heading `## Task N`** cho plan-file (nếu không SDD `task-brief` gãy). Không có
blocker kiến trúc.

---

## 14. Hợp đồng `/planner` chế độ Native (quyết định #2)

Với Native mode, **spec-kit sở hữu upstream, `/planner` sở hữu từ `tasks.md` trở
đi**. Ranh giới rõ:

```
User (spec-kit, tự chạy)                 /planner (planexec, native mode)
──────────────────────────              ─────────────────────────────────
/speckit.constitution ─┐
/speckit.specify        │  → specs/NNN/spec.md
/speckit.clarify        │  → (spec đã rõ)
/speckit.plan           │  → specs/NNN/plan.md
/speckit.tasks ─────────┘  → specs/NNN/tasks.md
                                  │
                                  └──► /planner <NNN|slug>
                                        Step A — Locate & load:
                                          đọc constitution + spec + plan + tasks
                                          của specs/NNN/. Nếu thiếu tasks.md →
                                          DỪNG, bảo user chạy chuỗi /speckit.* trước.
                                        Step B — Ground (light explore):
                                          đối chiếu tasks.md với codebase thật
                                          (grep/read, đúng kỷ luật "planner không
                                          đụng code").
                                        [GATE 1] xác nhận tasks/scope
                                        Step C — Detailed plan (= Step 4 cũ):
                                          tasks.md (T001…) → docs/plans/<id>.md
                                          heading "## Task N" + "## Global
                                          Constraints" (nhồi constitution) +
                                          executor-plan content. writing-plans +
                                          executor-plan skill.
                                        [GATE 2] Dispatch / Modify / Cancel
                                        Step D — SDD execute (= Step 5, Phương án A):
                                          per-task implementer + task-review +
                                          fix-loop; ledger .superpowers/sdd/.
                                        Step E — planner whole-branch verify
                                          (git diff + final verification) → summary
```

**KHÔNG dùng `/speckit.implement`** — Step D thay thế.

**Điểm cần quyết ở Phase 1 khi viết:** `/planner` định vị `specs/NNN/` bằng gì —
tham số số thứ tự/slug, hay auto-detect thư mục mới nhất? (đề xuất: arg tường minh,
fallback latest). → đã chọn: arg number/slug, empty = latest.

---

## 15. Phase 4 — port OpenCode / Codex (2026-07-13)

Đọc adapter đa-tool của superpowers (`.opencode/plugins/superpowers.js`,
`docs/README.opencode.md`, `docs/porting-to-a-new-harness.md`).

**Cơ chế dispatch SDD (verified):** prompt template ghi `Subagent
(general-purpose):`. Map theo harness:
- Claude Code: Task tool, subagent `general-purpose`.
- **OpenCode:** `task` tool với **`subagent_type: "general"`** (hoặc `"explore"`
  cho khám phá). ⟶ planner phải cho phép `task: general: allow` + bash cho 3
  script (`task-brief`/`review-package`/`sdd-workspace`).
- **Codex:** subagent dispatch **cần bật multi-agent**; nếu không, SDD
  **degrade về làm inline** — "never invent a Task call". ⟶ đây là giới hạn
  harness, không vá được.

**Đã port:**
- **OpenCode** (đầy đủ): `.opencode/agents/planner.md` (native Step A–E, permission
  mở cho `general` + scripts + git branch), `.opencode/commands/planner.md` (thin),
  `opencode.json` (thêm override model rẻ cho agent `general`).
- **Codex** (pragmatic + có caveat): `codex/.codex/prompts/planner.md` (native
  Step A–E). Step D nêu rõ 2 nhánh: có multi-agent → theo SDD skill (executor =
  implementer, reviewer subagent, fix-loop); không có → executor per-task +
  planner review inline (read-only git diff), mất isolation reviewer nhưng giữ
  per-task gating.
- 3 executor (`executor.md` ×2 + `executor.toml`): đổi commit convention
  `step N` → `task N` cho khớp `## Task N` (reviewer đọc commit list không lệch).

**Giới hạn còn lại (chưa verify chạy):** toàn bộ flow chưa chạy end-to-end trên
bất kỳ tool nào; cần cài spec-kit + superpowers + 1 feature `specs/NNN/` thật để
smoke-test. Codex degraded-mode chưa được kiểm nghiệm.

---

## 16. Smoke-test cơ chế script (2026-07-13)

Repo scratch + plan-file mẫu đúng format mới, chạy script SDD thật.

**✅ Verified chạy đúng:**
- `task-brief PLAN 1` rút **đúng** nội dung Task 1; **loại** `# Plan` + `##
  Context` + `## Global Constraints` phía trên.
- Dòng decoy `## Task 5:` đặt **trong code fence** KHÔNG làm đứt extraction
  (infence bảo vệ đúng) — hợp đồng `## Task N` vững.
- `review-package BASE HEAD` xuất commit list + `git diff --stat` + `git diff
  -U10`, range `BASE..HEAD` chuẩn. Commit `task 1:`/`task 2:` (convention mới)
  hiển thị sạch trong package cho reviewer.
- `sdd-workspace` tạo `.superpowers/sdd/` + `.gitignore=*`; `git status` không
  thấy workspace (tự ignore đúng). Ledger `progress.md` ghi bình thường.

**⚠️ Wart có thật (đã vá bằng doc):** `## Final verification` (mọi section sau
task cuối) **rò vào brief của task cuối** vì không phải heading `Task N`. Lành
tính (controller sở hữu verification toàn plan; Out of scope ride along còn hữu
ích), đã ghi rõ "Extraction boundary" trong skill `executor-plan`.

**Chưa test được từ đây:** phần LLM chạy `/planner` end-to-end (consume spec-kit
→ sinh plan-file conformant → controller dispatch) — cần 1 session Claude/OpenCode
thật của user. Codex degraded-mode chưa kiểm nghiệm.

---

## 17. Codex review — 4 fix (2026-07-13)

Review (base-branch) trên commit tích hợp phát hiện 4 lỗi, đã sửa cả 3 tool:

1. 🔴 **BASE ghi sai thứ tự** (Step D): BASE phải ghi (`git rev-parse HEAD`)
   **TRƯỚC khi dispatch** implementer — ghi sau thì HEAD đã tiến, `BASE..HEAD`
   rỗng → review package trống. Sửa: "record BASE FIRST, before dispatching".
2. 🔴 **`git diff ticket/<NNN>` rỗng** (Step E): đang đứng trên chính nhánh đó,
   diff bare không thấy commit. Sửa cuối (xem #5): bắt `BRANCH_BASE=$(git
   rev-parse HEAD)` **trước** `git switch -c`, rồi `git diff BRANCH_BASE..HEAD`.
3. 🔴 **Codex degraded mode mâu thuẫn**: multi-agent tắt vẫn bảo dispatch
   `executor`, nhưng dispatch cũng cần multi-agent. Sửa: multi-agent tắt →
   **STOP, yêu cầu bật multi-agent** (planner không tự viết code).
4. 🟡 **Verification bị deny ngoài Flutter** (permission OpenCode): bash
   `"*": deny` chặn `npm test`/`pytest`/`cargo test`… Sửa: đổi default bash
   sang `"*": ask` (whitelist read-only vẫn allow; lệnh khác hỏi user).

**Fix vòng 2 (hardcode `main`):**

5. 🔴 **Hardcode `main`** (Step D/E cả 3 tool): `git merge-base main HEAD` (fix
   tạm ở #2) sai khi project dùng `master`/`dev` hoặc feature branch tạo từ
   nhánh khác → verification lỗi hoặc chứa commit ngoài scope. Sửa: bắt
   **`BRANCH_BASE=$(git rev-parse HEAD)` NGAY TRƯỚC `git switch -c`** (ghi vào
   ledger), dùng `BRANCH_BASE` cho cả Step E diff và `review-package BRANCH_BASE
   HEAD` của final review. Không còn tên nhánh hardcode.

**Fix vòng 3 (resume idempotency):**

6. 🔴 **Capture BRANCH_BASE khi resume là sai** (Step D cả 3 tool): chạy lại
   trên `ticket/<NNN>` đang tồn tại thì `git rev-parse HEAD` trả commit task mới
   nhất → BRANCH_BASE sai → final diff âm thầm mất các task trước; `git switch
   -c` cũng fail vì branch đã có. Sửa: branch-setup **idempotent** — nếu branch
   `ticket/<NNN>` đã tồn tại HOẶC ledger đã có BRANCH_BASE → RESUME (reuse
   BRANCH_BASE từ ledger + `git switch` branch cũ); chỉ capture `HEAD` +
   `git switch -c` khi tạo branch mới. Không bao giờ capture lại HEAD lúc resume.

7. 🔴 **Điều kiện resume dùng `OR` là sai** (Step D cả 3 tool): #6 dùng "branch
   tồn tại OR ledger có BRANCH_BASE" → branch-only thì không có base để reuse,
   ledger-only thì không có branch để switch. Sửa thành **3-state**: cả hai tồn
   tại → RESUME; cả hai không → fresh start; **chỉ một → STOP báo inconsistent
   state** (không đoán base, không ghi đè branch).
