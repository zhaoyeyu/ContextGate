#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import statistics
import subprocess
import time
from dataclasses import asdict, dataclass
from pathlib import Path

OPENCLAW = ["openclaw"]

PROFILES = {
    "baseline": "baseline",
    "treatment": "treatment",
}


@dataclass
class TurnResult:
    profile: str
    case_id: str
    turn_index: int
    session_id: str
    message: str
    duration_ms: int | None
    provider: str | None
    model: str | None
    usage_input: int | None
    usage_output: int | None
    usage_total: int | None
    prompt_tokens: int | None
    text: str
    raw_stdout: str
    ok: bool = True
    error: str | None = None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run a local OpenClaw A/B comparison in the Ubuntu VM.")
    parser.add_argument("--suite", required=True, help="Path to a JSON suite file inside the VM.")
    parser.add_argument(
        "--openclaw-command",
        nargs="+",
        default=["openclaw"],
        help="Command used to invoke OpenClaw, including an optional runtime prefix.",
    )
    parser.add_argument("--baseline-profile", default="baseline", help="OpenClaw profile for the baseline run.")
    parser.add_argument("--treatment-profile", default="treatment", help="OpenClaw profile for the ContextGate run.")
    parser.add_argument(
        "--output-root",
        default="evaluation-output/vm-ab",
        help="Directory under which per-suite report folders are created.",
    )
    return parser.parse_args()


def load_suite(path: str) -> dict:
    suite_path = Path(path)
    data = json.loads(suite_path.read_text(encoding="utf-8"))
    if "suite_id" not in data or "cases" not in data:
        raise ValueError(f"Invalid suite file: {suite_path}")
    return data


def extract_json(stdout: str) -> dict:
    start = stdout.find("{")
    if start < 0:
        raise ValueError("No JSON object found in stdout")
    decoder = json.JSONDecoder()
    payload, _ = decoder.raw_decode(stdout[start:])
    return payload


def run_turn(profile: str, case_id: str, turn_index: int, session_id: str, message: str) -> TurnResult:
    cmd = OPENCLAW + [
        "--profile",
        profile,
        "agent",
        "--local",
        "--json",
        "--agent",
        "main",
        "--thinking",
        "minimal",
        "--timeout",
        "180",
        "--session-id",
        session_id,
        "--message",
        message,
    ]
    started = time.time()
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=420)
    except subprocess.TimeoutExpired as exc:
        stdout = (exc.stdout or "") + (exc.stderr or "")
        return TurnResult(
            profile=profile,
            case_id=case_id,
            turn_index=turn_index,
            session_id=session_id,
            message=message,
            duration_ms=420000,
            provider=None,
            model=None,
            usage_input=None,
            usage_output=None,
            usage_total=None,
            prompt_tokens=None,
            text="",
            raw_stdout=stdout,
            ok=False,
            error=f"timeout after {exc.timeout}s",
        )
    elapsed_ms = int((time.time() - started) * 1000)
    stdout = (proc.stdout or "") + (proc.stderr or "")
    if proc.returncode != 0:
        return TurnResult(
            profile=profile,
            case_id=case_id,
            turn_index=turn_index,
            session_id=session_id,
            message=message,
            duration_ms=elapsed_ms,
            provider=None,
            model=None,
            usage_input=None,
            usage_output=None,
            usage_total=None,
            prompt_tokens=None,
            text="",
            raw_stdout=stdout,
            ok=False,
            error=f"command failed ({proc.returncode})",
        )
    payload = extract_json(stdout)
    meta = payload.get("meta", {})
    agent_meta = meta.get("agentMeta", {})
    usage = agent_meta.get("usage", {}) or {}
    payloads = payload.get("payloads", [])
    text = "\n".join(item.get("text", "") for item in payloads if item.get("text"))
    return TurnResult(
        profile=profile,
        case_id=case_id,
        turn_index=turn_index,
        session_id=session_id,
        message=message,
        duration_ms=meta.get("durationMs", elapsed_ms),
        provider=agent_meta.get("provider"),
        model=agent_meta.get("model"),
        usage_input=usage.get("input"),
        usage_output=usage.get("output"),
        usage_total=usage.get("total"),
        prompt_tokens=agent_meta.get("promptTokens"),
        text=text,
        raw_stdout=stdout,
        ok=True,
        error=None,
    )


def summarize(results: list[TurnResult], cases: list[dict]) -> dict:
    by_profile: dict[str, dict[str, float | int]] = {}
    for label, profile_name in PROFILES.items():
        subset = [r for r in results if r.profile == profile_name]
        if not subset:
            by_profile[label] = {
                "runs": 0,
                "ok_runs": 0,
                "failed_runs": 0,
                "avg_input": 0,
                "avg_output": 0,
                "avg_total": 0,
                "avg_duration_ms": 0,
                "sum_input": 0,
                "sum_output": 0,
                "sum_total": 0,
            }
            continue
        by_profile[label] = {
            "runs": len(subset),
            "ok_runs": sum(1 for r in subset if r.ok),
            "failed_runs": sum(1 for r in subset if not r.ok),
            "avg_input": statistics.mean(r.usage_input or 0 for r in subset),
            "avg_output": statistics.mean(r.usage_output or 0 for r in subset),
            "avg_total": statistics.mean(r.usage_total or 0 for r in subset),
            "avg_duration_ms": statistics.mean(r.duration_ms or 0 for r in subset),
            "sum_input": sum(r.usage_input or 0 for r in subset),
            "sum_output": sum(r.usage_output or 0 for r in subset),
            "sum_total": sum(r.usage_total or 0 for r in subset),
        }

    per_case: dict[str, dict[str, float | int | str]] = {}
    for case in cases:
        case_id = case["id"]
        case_results = [r for r in results if r.case_id == case_id]
        baseline = [r for r in case_results if r.profile == PROFILES["baseline"]]
        treatment = [r for r in case_results if r.profile == PROFILES["treatment"]]
        base_total = sum(r.usage_total or 0 for r in baseline)
        treat_total = sum(r.usage_total or 0 for r in treatment)
        per_case[case_id] = {
            "domain": case.get("domain", "unknown"),
            "turns": len(case.get("turns", [])),
            "baseline_ok": sum(1 for r in baseline if r.ok),
            "treatment_ok": sum(1 for r in treatment if r.ok),
            "baseline_total": base_total,
            "treatment_total": treat_total,
            "delta_total": treat_total - base_total,
            "delta_total_pct": (((treat_total - base_total) / base_total) * 100) if base_total else 0,
            "baseline_avg_duration_ms": statistics.mean(r.duration_ms or 0 for r in baseline) if baseline else 0,
            "treatment_avg_duration_ms": statistics.mean(r.duration_ms or 0 for r in treatment) if treatment else 0,
        }

    base = by_profile["baseline"]
    treat = by_profile["treatment"]
    return {
        "profiles": by_profile,
        "per_case": per_case,
        "delta": {
            "sum_input": treat["sum_input"] - base["sum_input"],
            "sum_output": treat["sum_output"] - base["sum_output"],
            "sum_total": treat["sum_total"] - base["sum_total"],
            "avg_duration_ms": treat["avg_duration_ms"] - base["avg_duration_ms"],
            "sum_total_pct": (((treat["sum_total"] - base["sum_total"]) / base["sum_total"]) * 100) if base["sum_total"] else 0,
        },
    }


def write_report(output_dir: Path, suite: dict, results: list[TurnResult], summary: dict) -> None:
    json_path = output_dir / "results.json"
    md_path = output_dir / "report.md"
    json_path.write_text(
        json.dumps(
            {
                "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "suite": suite,
                "profiles": PROFILES,
                "results": [asdict(r) for r in results],
                "summary": summary,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    lines = [
        "# Predictive Gating A/B Report",
        "",
        f"Suite: `{suite['suite_id']}`",
        "",
        suite.get("description", ""),
        "",
        "Profiles:",
        f"- baseline: `{PROFILES['baseline']}` (`legacy` context engine)",
        f"- treatment: `{PROFILES['treatment']}` (`predictive-gating` context engine)",
        "",
        "Suite notes:",
    ]
    lines.extend(f"- {note}" for note in suite.get("notes", []))
    lines.extend(
        [
            "",
            "Executed cases:",
        ]
    )
    for case in suite["cases"]:
        lines.append(
            f"- `{case['id']}` ({case.get('domain', 'unknown')}, {len(case.get('turns', []))} turns): {case.get('goal', '')}"
        )

    lines.extend(
        [
            "",
            "## Aggregate",
            "",
            "| Metric | Baseline | Treatment | Delta |",
            "|---|---:|---:|---:|",
            f"| Successful turns | {summary['profiles']['baseline']['ok_runs']:.0f} | {summary['profiles']['treatment']['ok_runs']:.0f} | {summary['profiles']['treatment']['ok_runs'] - summary['profiles']['baseline']['ok_runs']:+.0f} |",
            f"| Failed turns | {summary['profiles']['baseline']['failed_runs']:.0f} | {summary['profiles']['treatment']['failed_runs']:.0f} | {summary['profiles']['treatment']['failed_runs'] - summary['profiles']['baseline']['failed_runs']:+.0f} |",
            f"| Sum input tokens | {summary['profiles']['baseline']['sum_input']:.0f} | {summary['profiles']['treatment']['sum_input']:.0f} | {summary['delta']['sum_input']:+.0f} |",
            f"| Sum output tokens | {summary['profiles']['baseline']['sum_output']:.0f} | {summary['profiles']['treatment']['sum_output']:.0f} | {summary['delta']['sum_output']:+.0f} |",
            f"| Sum total tokens | {summary['profiles']['baseline']['sum_total']:.0f} | {summary['profiles']['treatment']['sum_total']:.0f} | {summary['delta']['sum_total']:+.0f} ({summary['delta']['sum_total_pct']:+.2f}%) |",
            f"| Avg duration ms | {summary['profiles']['baseline']['avg_duration_ms']:.0f} | {summary['profiles']['treatment']['avg_duration_ms']:.0f} | {summary['delta']['avg_duration_ms']:+.0f} |",
            "",
            "## Per Case",
            "",
            "| Case | Domain | Turns | Baseline OK | Treatment OK | Baseline Total | Treatment Total | Delta |",
            "|---|---|---:|---:|---:|---:|---:|---:|",
        ]
    )
    for case_id, item in summary["per_case"].items():
        lines.append(
            f"| `{case_id}` | `{item['domain']}` | {item['turns']} | {item['baseline_ok']} | {item['treatment_ok']} | {item['baseline_total']:.0f} | {item['treatment_total']:.0f} | {item['delta_total']:+.0f} ({item['delta_total_pct']:+.2f}%) |"
        )

    lines.extend(
        [
            "",
            "## Per Turn",
            "",
            "| Profile | Case | Turn | OK | Input | Output | Total | Duration ms | Response / Error |",
            "|---|---|---:|---|---:|---:|---:|---:|---|",
        ]
    )
    for r in results:
        response = (r.text if r.ok else (r.error or "failed")).replace("\n", " ").replace("|", "/")
        lines.append(
            f"| `{r.profile}` | `{r.case_id}` | {r.turn_index} | {'yes' if r.ok else 'no'} | {r.usage_input or 0} | {r.usage_output or 0} | {r.usage_total or 0} | {r.duration_ms or 0} | {response} |"
        )
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def save_progress(output_dir: Path, suite: dict, results: list[TurnResult]) -> None:
    summary = summarize(results, suite["cases"]) if results else {}
    write_report(output_dir, suite, results, summary) if results else None


def main() -> None:
    global OPENCLAW, PROFILES
    args = parse_args()
    OPENCLAW = args.openclaw_command
    PROFILES = {
        "baseline": args.baseline_profile,
        "treatment": args.treatment_profile,
    }
    suite = load_suite(args.suite)
    output_dir = Path(args.output_root) / suite["suite_id"]
    output_dir.mkdir(parents=True, exist_ok=True)

    results: list[TurnResult] = []
    for label, profile_name in PROFILES.items():
        for case in suite["cases"]:
            session_id = f"ab-{label}-{case['id']}"
            for turn_index, message in enumerate(case["turns"], start=1):
                result = run_turn(profile_name, case["id"], turn_index, session_id, message)
                results.append(result)
                save_progress(output_dir, suite, results)
                print(
                    f"{label} {case['id']} turn {turn_index}: "
                    f"ok={result.ok} input={result.usage_input} output={result.usage_output} total={result.usage_total} "
                    f"duration_ms={result.duration_ms}"
                )
    summary = summarize(results, suite["cases"])
    write_report(output_dir, suite, results, summary)
    print(f"saved {output_dir / 'results.json'}")
    print(f"saved {output_dir / 'report.md'}")


if __name__ == "__main__":
    main()
