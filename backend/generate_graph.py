"""按 backend/schema.ngql 用 NebulaGraph 5.x GQL 生成 anti_fraud_kg。

默认：点 + 边合计 1,000,000（25 万点、75 万边）。
"""
from __future__ import annotations

import argparse
import random
import re
import sys
import time
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Iterable, Iterator, Sequence

from config import (
    NEBULA_HOST,
    NEBULA_PASSWORD,
    NEBULA_POOL_MAX,
    NEBULA_PORT,
    NEBULA_TIMEOUT,
    NEBULA_USER,
)

SCHEMA_PATH = Path(__file__).resolve().parent / "schema.ngql"
DEFAULT_GRAPH = "anti_fraud_kg"
DEFAULT_TOTAL = 1_000_000
VERTEX_SHARE = 0.25
SPACE_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
WRITER_TIMEOUT_MS = 300_000
VERTEX_BATCH = 500
EDGE_BATCH = 100
_NON_RETRYABLE = (
    "Element type matching",
    "syntax error",
    "[42001]",
    "primary key constraint",
    "multi-edge key constraint",
    "shouldn't refer to multiple node types",
    "Invalid syntax",
    "Edge type not found",
)

TAG_FIELDS: dict[str, tuple[str, ...]] = {
    "company": (
        "name", "unified_code", "industry", "registered_capital", "established_date",
        "address", "phone", "risk_score", "is_lost", "lost_days",
    ),
    "person": ("name", "id_card", "phone", "address", "risk_score"),
    "account": ("name", "account_no", "bank", "open_date", "risk_score"),
    "loan": (
        "name", "contract_no", "amount", "currency", "issue_date",
        "maturity_date", "status", "risk_score",
    ),
}

EDGE_FIELDS: dict[str, tuple[str, ...]] = {
    "holds_account": ("open_date", "relation"),
    "applied_for": ("apply_date", "amount"),
    "disbursed_to": ("disburse_date", "amount"),
    "transfer": ("tx_date", "amount", "currency", "memo", "channel"),
    "guarantees": ("guarantee_date", "amount", "guarantee_type"),
    "controls": ("relation", "share_ratio", "since"),
    "shareholder": ("share_ratio", "invest_amount"),
    "employs": ("position", "since"),
    "related_to": ("relation", "source", "since"),
}

EDGE_ENDPOINTS: dict[str, tuple[tuple[str, str], ...]] = {
    "holds_account": (("company", "account"),),
    "applied_for": (("company", "loan"), ("person", "loan")),
    "disbursed_to": (("loan", "account"),),
    "transfer": (("account", "account"),),
    "guarantees": (("company", "company"),),
    "controls": (("person", "company"),),
    "shareholder": (("person", "company"), ("company", "company")),
    "employs": (("person", "company"),),
    "related_to": (("company", "company"), ("person", "person")),
}

NAMED_COMPANIES = ("凯达建材有限公司", "东方贸易集团", "远景电子科技有限公司")
INDUSTRIES = ("制造业", "批发零售", "软件服务", "物流运输", "建筑业", "金融服务", "农业", "能源")
BANKS = ("工行上海分行", "建行北京分行", "农行深圳分行", "中行广州分行", "招商银行杭州分行")
CITIES = ("上海市", "北京市", "深圳市", "广州市", "杭州市", "成都市", "武汉市", "南京市")
POSITIONS = ("法定代表人", "董事", "监事", "财务负责人", "经理")


@dataclass(frozen=True)
class VertexRecord:
    tag: str
    vid: str
    values: tuple[Any, ...]


@dataclass(frozen=True)
class EdgeRecord:
    edge_type: str
    source: str
    target: str
    rank: int
    values: tuple[Any, ...]


def vertex_counts(total_vertices: int) -> dict[str, int]:
    if total_vertices < 10:
        raise ValueError("顶点数量至少为 10")
    company = total_vertices * 30 // 100
    person = total_vertices * 20 // 100
    account = total_vertices * 40 // 100
    return {
        "company": company,
        "person": person,
        "account": account,
        "loan": total_vertices - company - person - account,
    }


def edge_counts(total_edges: int) -> dict[str, int]:
    if total_edges < 0:
        raise ValueError("边数量不能为负数")
    names = list(EDGE_FIELDS)
    base, remainder = divmod(total_edges, len(names))
    return {name: base + (1 if index < remainder else 0) for index, name in enumerate(names)}


def split_total(total: int) -> tuple[int, int]:
    if total < 40:
        raise ValueError("点+边合计至少为 40")
    vertices = max(10, int(total * VERTEX_SHARE))
    edges = total - vertices
    if edges < 9:
        raise ValueError("边数量太少，无法覆盖 9 种关系")
    return vertices, edges


def vertex_id(tag: str, index: int) -> str:
    marker = {"company": "c", "person": "p", "account": "a", "loan": "l"}[tag]
    return f"{marker}_{index:07d}"


def node_label_from_vid(vid: str) -> str:
    marker = vid.split("_", 1)[0]
    return {"c": "company", "p": "person", "a": "account", "l": "loan"}[marker]


def declared_edge_type_name(edge_type: str, source_type: str, target_type: str) -> str:
    endpoints = EDGE_ENDPOINTS[edge_type]
    if len(endpoints) == 1:
        return edge_type
    return f"{edge_type}_{source_type}_{target_type}"


def _event_date(rng: random.Random, start: date, days: int) -> str:
    return (start + timedelta(days=rng.randrange(days))).isoformat()


def iter_vertices(tag: str, count: int, *, seed: int) -> Iterator[VertexRecord]:
    rng = random.Random(seed + {"company": 11, "person": 23, "account": 37, "loan": 53}[tag])
    for index in range(count):
        vid = vertex_id(tag, index)
        if tag == "company":
            is_lost = rng.random() < 0.025
            name = NAMED_COMPANIES[index] if index < len(NAMED_COMPANIES) else f"测试企业{index:07d}有限公司"
            if index == 2:
                is_lost = True
            values = (
                name,
                f"91{seed % 10_000:04d}{index:012d}"[-18:],
                rng.choice(INDUSTRIES),
                round(rng.uniform(1_000_000, 500_000_000), 2),
                _event_date(rng, date(1985, 1, 1), 14_000),
                f"{rng.choice(CITIES)}测试路{rng.randrange(1, 9999)}号",
                f"0{rng.randrange(10, 99)}-{rng.randrange(10_000_000, 99_999_999)}",
                rng.randrange(0, 101),
                is_lost,
                rng.randrange(30, 366) if is_lost else 0,
            )
        elif tag == "person":
            values = (
                f"测试人员{index:07d}",
                f"320101{rng.randrange(1960, 2003)}{rng.randrange(1, 13):02d}{rng.randrange(1, 29):02d}{index:04d}"[-18:],
                f"1{rng.randrange(30, 99)}{rng.randrange(0, 100_000_000):08d}",
                f"{rng.choice(CITIES)}社区{rng.randrange(1, 9999)}号",
                rng.randrange(0, 101),
            )
        elif tag == "account":
            values = (
                f"测试账户{index:07d}",
                f"62{seed % 10_000:04d}{index:013d}"[-19:],
                rng.choice(BANKS),
                _event_date(rng, date(2005, 1, 1), 7_300),
                rng.randrange(0, 101),
            )
        else:
            issue = date(2020, 1, 1) + timedelta(days=rng.randrange(2_000))
            values = (
                f"流动资金贷款{index:07d}",
                f"DK-{seed}-{index:07d}",
                round(rng.uniform(100_000, 50_000_000), 2),
                "CNY",
                issue.isoformat(),
                (issue + timedelta(days=rng.choice((180, 365, 730, 1095)))).isoformat(),
                rng.choice(("正常", "关注", "逾期", "结清")),
                rng.randrange(0, 101),
            )
        yield VertexRecord(tag, vid, values)


def iter_edges(
    edge_type: str,
    count: int,
    *,
    vertex_totals: dict[str, int],
    seed: int,
) -> Iterator[EdgeRecord]:
    type_index = list(EDGE_FIELDS).index(edge_type)
    rng = random.Random(seed + 10_000 + type_index * 997)
    start = date(2022, 1, 1)
    seen: set[tuple[str, str]] = set()

    def pick(tag: str) -> str:
        return vertex_id(tag, rng.randrange(vertex_totals[tag]))

    def different(tag: str) -> tuple[str, str]:
        source_index = rng.randrange(vertex_totals[tag])
        target_index = rng.randrange(vertex_totals[tag] - 1)
        if target_index >= source_index:
            target_index += 1
        return vertex_id(tag, source_index), vertex_id(tag, target_index)

    def unique_pair(factory) -> tuple[str, str]:
        for _ in range(200):
            source, target = factory()
            pair = (source, target)
            if source != target and pair not in seen:
                seen.add(pair)
                return source, target
        raise RuntimeError(f"{edge_type} 无法生成不重复的 (src, dst)")

    for index in range(count):
        rank = index + 1
        event_date = _event_date(rng, start, 1_700)
        if edge_type == "holds_account":
            source, target = unique_pair(lambda: (pick("company"), pick("account")))
            values = (event_date, rng.choice(("基本户", "一般户", "结算户")))
        elif edge_type == "applied_for":
            source, target = unique_pair(
                lambda: (
                    pick("company") if rng.random() < 0.9 else pick("person"),
                    pick("loan"),
                )
            )
            values = (event_date, round(rng.uniform(100_000, 50_000_000), 2))
        elif edge_type == "disbursed_to":
            source, target = unique_pair(lambda: (pick("loan"), pick("account")))
            values = (event_date, round(rng.uniform(100_000, 50_000_000), 2))
        elif edge_type == "transfer":
            source, target = unique_pair(lambda: different("account"))
            values = (
                f"{event_date} {rng.randrange(0, 24):02d}:{rng.randrange(0, 60):02d}:00",
                round(rng.uniform(100, 10_000_000), 2),
                "CNY",
                rng.choice(("货款", "往来款", "服务费", "借款", "投资款", "其他")),
                rng.choice(("网银", "柜面", "手机银行", "跨行转账")),
            )
        elif edge_type == "guarantees":
            source, target = unique_pair(lambda: different("company"))
            values = (
                event_date,
                round(rng.uniform(100_000, 100_000_000), 2),
                rng.choice(("连带责任保证", "一般保证", "抵押担保")),
            )
        elif edge_type == "controls":
            source, target = unique_pair(lambda: (pick("person"), pick("company")))
            values = (
                rng.choice(("实际控制人", "法定代表人", "一致行动人")),
                round(rng.uniform(0.05, 0.95), 4),
                event_date,
            )
        elif edge_type == "shareholder":
            source, target = unique_pair(
                lambda: (
                    pick("person") if rng.random() < 0.7 else pick("company"),
                    pick("company"),
                )
            )
            values = (round(rng.uniform(0.01, 0.9), 4), round(rng.uniform(100_000, 100_000_000), 2))
        elif edge_type == "employs":
            source, target = unique_pair(lambda: (pick("person"), pick("company")))
            values = (rng.choice(POSITIONS), event_date)
        else:
            source, target = unique_pair(
                lambda: different("company" if rng.random() < 0.7 else "person")
            )
            values = (
                rng.choice(("上下游", "同一地址", "亲属", "交易对手", "共同联系人")),
                rng.choice(("工商", "交易流水", "公开信息", "测试生成")),
                event_date,
            )
        yield EdgeRecord(edge_type, source, target, rank, values)


def load_schema_statements(path: Path = SCHEMA_PATH) -> list[str]:
    statements: list[str] = []
    buffer: list[str] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("--"):
            continue
        buffer.append(line)
        joined = " ".join(buffer)
        if joined.startswith("CREATE GRAPH TYPE") and joined.endswith("}"):
            statements.append("\n".join(buffer))
            buffer = []
        elif joined.startswith("CREATE GRAPH IF NOT EXISTS") or joined.startswith("SESSION SET GRAPH"):
            statements.append(joined)
            buffer = []
    if buffer:
        statements.append("\n".join(buffer))
    return statements


def _quote(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    if value is None:
        return "NULL"
    escaped = str(value).replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
    return f'"{escaped}"'


def _table_value(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    if value is None:
        return "NULL"
    escaped = str(value).replace("\\", "\\\\").replace("'", "\\'")
    return f"'{escaped}'"


def _properties(pairs: Sequence[tuple[str, Any]]) -> str:
    return ", ".join(f"{name}: {_quote(value)}" for name, value in pairs)


def vertex_statement(tag: str, rows: Sequence[VertexRecord]) -> str:
    fields = TAG_FIELDS[tag]
    nodes = ",\n       ".join(
        f"(@{tag}{{{_properties((('id', row.vid), *zip(fields, row.values)))}}})"
        for row in rows
    )
    return f"INSERT {nodes}"


def _typed_edge_table(
    edge_type: str, source_type: str, target_type: str, rows: Sequence[EdgeRecord],
) -> str:
    fields = ("rank", *EDGE_FIELDS[edge_type])
    columns = ("src_id", "dst_id", *fields)
    tuples = []
    for row in rows:
        values = [_table_value(row.source), _table_value(row.target), _table_value(row.rank)]
        values.extend(_table_value(value) for value in row.values)
        tuples.append("(" + ", ".join(values) + ")")
    assignments = ", ".join(f"{name}: re.{name}" for name in fields)
    table_rows = ",\n    ".join(tuples)
    type_name = declared_edge_type_name(edge_type, source_type, target_type)
    return (
        f"TABLE batch_rows {{ {', '.join(columns)} }} =\n"
        f"    {table_rows}\n"
        "FOR re IN batch_rows\n"
        f"MATCH (s@{source_type}{{id: re.src_id}}), (d@{target_type}{{id: re.dst_id}})\n"
        f"INSERT (s)-[@{type_name}{{{assignments}}}]->(d)"
    )


def edge_statements(edge_type: str, rows: Sequence[EdgeRecord]) -> list[str]:
    groups: dict[tuple[str, str], list[EdgeRecord]] = {}
    for row in rows:
        key = (node_label_from_vid(row.source), node_label_from_vid(row.target))
        groups.setdefault(key, []).append(row)
    return [
        _typed_edge_table(edge_type, source_type, target_type, chunk)
        for (source_type, target_type), chunk in groups.items()
    ]


def _chunks(records: Iterable[Any], size: int) -> Iterator[list[Any]]:
    chunk: list[Any] = []
    for record in records:
        chunk.append(record)
        if len(chunk) == size:
            yield chunk
            chunk = []
    if chunk:
        yield chunk


def _error(result: Any) -> str | None:
    succeeded = getattr(result, "is_succeeded", None)
    succeeded = succeeded() if callable(succeeded) else succeeded
    if succeeded is True:
        return None
    code_attr = getattr(result, "status_code", getattr(result, "error_code", -1))
    code = code_attr() if callable(code_attr) else code_attr
    if code in (0, "00000"):
        return None
    message_attr = getattr(result, "status_message", getattr(result, "error_msg", ""))
    message = message_attr() if callable(message_attr) else message_attr
    if isinstance(message, bytes):
        message = message.decode("utf-8", errors="replace")
    return str(message or f"NebulaGraph error code {code}")


class NebulaWriter:
    def __init__(self, *, graph: str) -> None:
        if not SPACE_PATTERN.fullmatch(graph):
            raise ValueError("Graph 名称格式非法")
        self.graph = graph
        self.pool: Any = None
        self.session: Any = None

    def __enter__(self) -> "NebulaWriter":
        try:
            from nebulagraph_python import NebulaPool, NebulaPoolConfig
        except ImportError as exc:
            raise RuntimeError("缺少 nebula5-python，请先安装 backend/requirements.txt") from exc
        config = NebulaPoolConfig(
            addresses=f"{NEBULA_HOST}:{NEBULA_PORT}",
            user_name=NEBULA_USER,
            password=NEBULA_PASSWORD,
            min_client_size=1,
            max_client_size=max(2, NEBULA_POOL_MAX),
            request_timeout_ms=NEBULA_TIMEOUT if NEBULA_TIMEOUT > 0 else WRITER_TIMEOUT_MS,
        )
        self.pool = NebulaPool(config)
        self.session = self.pool.get_client()
        return self

    def __exit__(self, exc_type: Any, exc: Any, traceback: Any) -> None:
        if self.session and self.pool:
            self.pool.return_client(self.session)
        if self.pool:
            self.pool.close()

    def execute(self, statement: str) -> None:
        result = self.session.execute(statement.strip().rstrip(";").strip())
        error = _error(result)
        if error:
            raise RuntimeError(error)

    def graph_exists(self) -> bool:
        try:
            self.execute(f"SESSION SET GRAPH {self.graph}")
            return True
        except RuntimeError as exc:
            message = str(exc).lower()
            if "not found" in message or "unknown graph" in message:
                return False
            raise

    def drop_existing(self) -> None:
        type_name = f"{self.graph}_type"
        for statement in (
            f"DROP GRAPH IF EXISTS {self.graph}",
            f"DROP GRAPH TYPE IF EXISTS {type_name}",
        ):
            try:
                self.execute(statement)
            except RuntimeError as exc:
                if "not found" not in str(exc).lower():
                    raise

    def prepare_graph(self, *, recreate: bool) -> None:
        if recreate and self.graph_exists():
            print(f"删除已有 Graph `{self.graph}` 后按 schema.ngql 重建。", flush=True)
            self.drop_existing()
        statements = load_schema_statements()
        if self.graph != DEFAULT_GRAPH:
            statements = [
                statement.replace(DEFAULT_GRAPH, self.graph)
                for statement in statements
            ]
        for statement in statements:
            self._retry(statement, attempts=30, delay=2)

    def _retry(self, statement: str, *, attempts: int, delay: int) -> None:
        last_error: Exception | None = None
        for _ in range(attempts):
            try:
                self.execute(statement)
                return
            except RuntimeError as exc:
                if any(token in str(exc) for token in _NON_RETRYABLE):
                    raise
                last_error = exc
                time.sleep(delay)
        raise RuntimeError(f"操作重试超时：{last_error}")


def write_stream(
    writer: NebulaWriter,
    *,
    schema_name: str,
    records: Iterable[Any],
    total: int,
    batch_size: int,
    is_edge: bool,
) -> None:
    written = 0
    chunk_size = min(batch_size, EDGE_BATCH) if is_edge else batch_size
    for chunk in _chunks(records, chunk_size):
        statements = (
            edge_statements(schema_name, chunk)
            if is_edge else
            [vertex_statement(schema_name, chunk)]
        )
        for statement in statements:
            writer._retry(statement, attempts=60, delay=2)
        written += len(chunk)
        if written % 50_000 == 0 or written == total:
            print(f"  {schema_name}: {written:,}/{total:,}", flush=True)


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="按 schema.ngql 生成 NebulaGraph 5.x 金融图")
    parser.add_argument("--graph", default=DEFAULT_GRAPH)
    parser.add_argument("--total", type=int, default=DEFAULT_TOTAL, help="点+边合计，默认 1000000")
    parser.add_argument("--seed", type=int, default=20260914)
    parser.add_argument("--batch-size", type=int, default=VERTEX_BATCH)
    parser.add_argument("--recreate", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--yes", action="store_true")
    return parser.parse_args(argv)


def main(argv: Iterable[str] | None = None) -> int:
    args = parse_args(argv)
    if not SPACE_PATTERN.fullmatch(args.graph):
        print("Graph 名称格式非法。", file=sys.stderr)
        return 2
    if not 1 <= args.batch_size <= 1_000:
        print("batch-size 必须在 1-1000 之间。", file=sys.stderr)
        return 2
    try:
        vertex_total, edge_total = split_total(args.total)
        vertices_by_type = vertex_counts(vertex_total)
        edges_by_type = edge_counts(edge_total)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    print(f"目标：graph={args.graph}，合计={args.total:,}（点={vertex_total:,}，边={edge_total:,}）")
    print("顶点分布：" + "，".join(f"{key}={value:,}" for key, value in vertices_by_type.items()))
    print("关系分布：" + "，".join(f"{key}={value:,}" for key, value in edges_by_type.items()))
    if args.dry_run:
        sample = next(iter_vertices("company", 1, seed=args.seed))
        print(vertex_statement("company", [sample]))
        return 0
    if not args.yes:
        print("拒绝写入：请追加 --yes 明确确认。", file=sys.stderr)
        return 2

    try:
        with NebulaWriter(graph=args.graph) as writer:
            exists = writer.graph_exists()
            if exists and not args.recreate:
                raise RuntimeError("目标 Graph 已存在；确认覆盖请追加 --recreate --yes")
            writer.prepare_graph(recreate=args.recreate)
            print("开始写入顶点：")
            for tag, count in vertices_by_type.items():
                write_stream(
                    writer,
                    schema_name=tag,
                    records=iter_vertices(tag, count, seed=args.seed),
                    total=count,
                    batch_size=args.batch_size,
                    is_edge=False,
                )
            print("开始写入关系：")
            for edge_type, count in edges_by_type.items():
                write_stream(
                    writer,
                    schema_name=edge_type,
                    records=iter_edges(
                        edge_type, count, vertex_totals=vertices_by_type, seed=args.seed,
                    ),
                    total=count,
                    batch_size=args.batch_size,
                    is_edge=True,
                )
    except Exception as exc:
        print(f"导入失败：{exc}", file=sys.stderr)
        return 1

    print(f"导入完成：{vertex_total:,} 个点，{edge_total:,} 条边，合计 {args.total:,}。")
    print("点查询示例：c_0000000（凯达建材有限公司）、c_0000001、c_0000002")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
