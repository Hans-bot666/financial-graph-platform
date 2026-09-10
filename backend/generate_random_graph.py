"""向 NebulaGraph 直接写入可重复的随机金融关系图。

默认生成 10,000 个顶点和 30,000 条边。脚本只连接真实 NebulaGraph，
连接或写入失败时立即退出，不会使用应用内 Mock。
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
    NEBULA_SPACE,
    NEBULA_TIMEOUT,
    NEBULA_USER,
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

INDUSTRIES = ("制造业", "批发零售", "软件服务", "物流运输", "建筑业", "金融服务", "农业", "能源")
BANKS = ("工行上海分行", "建行北京分行", "农行深圳分行", "中行广州分行", "招商银行杭州分行")
CITIES = ("上海市", "北京市", "深圳市", "广州市", "杭州市", "成都市", "武汉市", "南京市")
POSITIONS = ("法定代表人", "董事", "监事", "财务负责人", "经理")
SPACE_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


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


@dataclass
class RandomGraph:
    vertices: dict[str, list[VertexRecord]]
    edges: dict[str, list[EdgeRecord]]

    @property
    def vertex_count(self) -> int:
        return sum(len(items) for items in self.vertices.values())

    @property
    def edge_count(self) -> int:
        return sum(len(items) for items in self.edges.values())


def _random_date(rng: random.Random, start: date, days: int) -> str:
    return (start + timedelta(days=rng.randrange(days))).isoformat()


def _allocate_vertices(total: int) -> dict[str, int]:
    if total < 10:
        raise ValueError("顶点数量至少为 10")
    companies = total * 30 // 100
    persons = total * 20 // 100
    accounts = total * 40 // 100
    return {
        "company": companies,
        "person": persons,
        "account": accounts,
        "loan": total - companies - persons - accounts,
    }


def build_random_graph(
    *,
    vertex_count: int = 10_000,
    edge_count: int = 30_000,
    seed: int = 20260910,
    prefix: str = "rnd",
) -> RandomGraph:
    """在内存中生成与 schema.ngql 一致且可重复的数据集。"""
    if edge_count < 0:
        raise ValueError("边数量不能为负数")
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,20}", prefix):
        raise ValueError("prefix 只能包含字母、数字、下划线或短横线，长度 1-20")

    rng = random.Random(seed)
    counts = _allocate_vertices(vertex_count)
    vertices = {tag: [] for tag in TAG_FIELDS}
    ids = {tag: [] for tag in TAG_FIELDS}

    for index in range(counts["company"]):
        vid = f"{prefix}_c_{index:06d}"
        ids["company"].append(vid)
        is_lost = rng.random() < 0.025
        vertices["company"].append(VertexRecord("company", vid, (
            f"随机企业{index:06d}有限公司",
            f"91{seed % 10_000:04d}{index:012d}"[-18:],
            rng.choice(INDUSTRIES),
            round(rng.uniform(1_000_000, 500_000_000), 2),
            _random_date(rng, date(1985, 1, 1), 14_000),
            f"{rng.choice(CITIES)}测试路{rng.randrange(1, 9999)}号",
            f"0{rng.randrange(10, 99)}-{rng.randrange(10_000_000, 99_999_999)}",
            rng.randrange(0, 101),
            is_lost,
            rng.randrange(30, 366) if is_lost else 0,
        )))

    for index in range(counts["person"]):
        vid = f"{prefix}_p_{index:06d}"
        ids["person"].append(vid)
        vertices["person"].append(VertexRecord("person", vid, (
            f"测试人员{index:06d}",
            f"310101{rng.randrange(1960, 2003)}{rng.randrange(1, 13):02d}{rng.randrange(1, 29):02d}{index:04d}"[-18:],
            f"1{rng.randrange(30, 99)}{rng.randrange(0, 100_000_000):08d}",
            f"{rng.choice(CITIES)}测试社区{rng.randrange(1, 999)}号",
            rng.randrange(0, 101),
        )))

    for index in range(counts["account"]):
        vid = f"{prefix}_a_{index:06d}"
        ids["account"].append(vid)
        vertices["account"].append(VertexRecord("account", vid, (
            f"测试账户{index:06d}",
            f"62{seed % 10_000:04d}{index:013d}"[-19:],
            rng.choice(BANKS),
            _random_date(rng, date(2005, 1, 1), 7_300),
            rng.randrange(0, 101),
        )))

    for index in range(counts["loan"]):
        vid = f"{prefix}_l_{index:06d}"
        ids["loan"].append(vid)
        issue = date(2020, 1, 1) + timedelta(days=rng.randrange(2_000))
        vertices["loan"].append(VertexRecord("loan", vid, (
            f"随机流动资金贷款{index:06d}",
            f"DK-{seed}-{index:06d}",
            round(rng.uniform(100_000, 50_000_000), 2),
            "CNY",
            issue.isoformat(),
            (issue + timedelta(days=rng.choice((180, 365, 730, 1095)))).isoformat(),
            rng.choice(("正常", "关注", "逾期", "结清")),
            rng.randrange(0, 101),
        )))

    edges = {edge_type: [] for edge_type in EDGE_FIELDS}
    edge_kinds = tuple(EDGE_FIELDS)
    base_day = date(2022, 1, 1)

    def different_pair(values: Sequence[str]) -> tuple[str, str]:
        source = rng.choice(values)
        target = rng.choice(values)
        while target == source:
            target = rng.choice(values)
        return source, target

    for rank in range(1, edge_count + 1):
        edge_type = edge_kinds[(rank - 1) % len(edge_kinds)]
        event_date = _random_date(rng, base_day, 1_700)
        if edge_type == "holds_account":
            source, target = rng.choice(ids["company"]), rng.choice(ids["account"])
            values = (event_date, rng.choice(("基本户", "一般户", "结算户")))
        elif edge_type == "applied_for":
            applicant_pool = ids["company"] if rng.random() < 0.9 else ids["person"]
            source, target = rng.choice(applicant_pool), rng.choice(ids["loan"])
            values = (event_date, round(rng.uniform(100_000, 50_000_000), 2))
        elif edge_type == "disbursed_to":
            source, target = rng.choice(ids["loan"]), rng.choice(ids["account"])
            values = (event_date, round(rng.uniform(100_000, 50_000_000), 2))
        elif edge_type == "transfer":
            source, target = different_pair(ids["account"])
            values = (
                f"{event_date} {rng.randrange(0, 24):02d}:{rng.randrange(0, 60):02d}:00",
                round(rng.uniform(100, 10_000_000), 2),
                "CNY",
                rng.choice(("货款", "往来款", "服务费", "借款", "投资款", "其他")),
                rng.choice(("网银", "柜面", "手机银行", "跨行转账")),
            )
        elif edge_type == "guarantees":
            source, target = different_pair(ids["company"])
            values = (
                event_date,
                round(rng.uniform(100_000, 100_000_000), 2),
                rng.choice(("连带责任保证", "一般保证", "抵押担保")),
            )
        elif edge_type == "controls":
            source, target = rng.choice(ids["person"]), rng.choice(ids["company"])
            values = (rng.choice(("实际控制人", "法定代表人", "一致行动人")), round(rng.uniform(0.05, 0.95), 4), event_date)
        elif edge_type == "shareholder":
            holder_pool = ids["person"] if rng.random() < 0.7 else ids["company"]
            source, target = rng.choice(holder_pool), rng.choice(ids["company"])
            values = (round(rng.uniform(0.01, 0.9), 4), round(rng.uniform(100_000, 100_000_000), 2))
        elif edge_type == "employs":
            source, target = rng.choice(ids["person"]), rng.choice(ids["company"])
            values = (rng.choice(POSITIONS), event_date)
        else:
            pool = ids["company"] if rng.random() < 0.7 else ids["person"]
            source, target = different_pair(pool)
            values = (
                rng.choice(("上下游", "同一地址", "亲属", "交易对手", "共同联系人")),
                rng.choice(("工商", "交易流水", "公开信息", "测试生成")),
                event_date,
            )
        edges[edge_type].append(EdgeRecord(edge_type, source, target, rank, values))

    return RandomGraph(vertices=vertices, edges=edges)


def _quote(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    if value is None:
        return "NULL"
    escaped = str(value).replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
    return f'"{escaped}"'


def vertex_statement(tag: str, rows: Sequence[VertexRecord]) -> str:
    fields = ", ".join(TAG_FIELDS[tag])
    values = ",\n".join(
        f'{_quote(row.vid)}:({", ".join(_quote(value) for value in row.values)})'
        for row in rows
    )
    return f"INSERT VERTEX {tag}({fields}) VALUES\n{values};"


def edge_statement(edge_type: str, rows: Sequence[EdgeRecord]) -> str:
    fields = ", ".join(EDGE_FIELDS[edge_type])
    values = ",\n".join(
        f'{_quote(row.source)} -> {_quote(row.target)}@{row.rank}:'
        f'({", ".join(_quote(value) for value in row.values)})'
        for row in rows
    )
    return f"INSERT EDGE {edge_type}({fields}) VALUES\n{values};"


def batches(items: Sequence[Any], size: int) -> Iterator[Sequence[Any]]:
    for start in range(0, len(items), size):
        yield items[start:start + size]


def _error(result: Any) -> str | None:
    succeeded = getattr(result, "is_succeeded", None)
    if callable(succeeded) and succeeded():
        return None
    code_attr = getattr(result, "error_code", -1)
    code = code_attr() if callable(code_attr) else code_attr
    if code == 0:
        return None
    message_attr = getattr(result, "error_msg", "")
    message = message_attr() if callable(message_attr) else message_attr
    if isinstance(message, bytes):
        message = message.decode("utf-8", errors="replace")
    return str(message or f"NebulaGraph error code {code}")


class NebulaWriter:
    def __init__(self, *, space: str) -> None:
        if not SPACE_PATTERN.fullmatch(space):
            raise ValueError("图空间名称格式非法")
        self.space = space
        self.pool: Any = None
        self.session: Any = None

    def __enter__(self) -> "NebulaWriter":
        try:
            from nebula3.Config import Config
            from nebula3.gclient.net import ConnectionPool
        except ImportError as exc:
            raise RuntimeError("缺少 nebula3-python，请先安装 backend/requirements.txt") from exc

        config = Config()
        config.min_connection_pool_size = 1
        config.max_connection_pool_size = max(2, NEBULA_POOL_MAX)
        config.timeout = NEBULA_TIMEOUT
        self.pool = ConnectionPool()
        if not self.pool.init([(NEBULA_HOST, NEBULA_PORT)], config):
            raise RuntimeError(f"无法连接 NebulaGraph {NEBULA_HOST}:{NEBULA_PORT}")
        self.session = self.pool.get_session(NEBULA_USER, NEBULA_PASSWORD)
        return self

    def __exit__(self, exc_type: Any, exc: Any, traceback: Any) -> None:
        if self.session:
            self.session.release()
        if self.pool:
            self.pool.close()

    def execute(self, statement: str) -> None:
        result = self.session.execute(statement)
        error = _error(result)
        if error:
            raise RuntimeError(error)

    def prepare_space(self, *, init_schema: bool, partition_num: int = 10) -> None:
        try:
            self.execute(f"USE {self.space};")
        except RuntimeError:
            if not init_schema:
                raise
            if not 1 <= partition_num <= 1_024:
                raise ValueError("partition_num 必须在 1-1024 之间")
            self.execute(
                f"CREATE SPACE IF NOT EXISTS {self.space} "
                f"(partition_num={partition_num}, replica_factor=1, vid_type=FIXED_STRING(64));"
            )
            self._retry(f"USE {self.space};", attempts=60, delay=2)

        if init_schema:
            schema_path = Path(__file__).with_name("schema.ngql")
            text = "\n".join(
                line for line in schema_path.read_text(encoding="utf-8").splitlines()
                if not line.lstrip().startswith("--")
            )
            statements = [statement.strip() + ";" for statement in text.split(";") if statement.strip()]
            schema_statements = [
                statement for statement in statements
                if statement.lower().startswith(("create tag ", "create edge "))
                and " index " not in statement.lower()
            ]
            for statement in schema_statements:
                self.execute(statement)
            self.wait_for_schema()
        else:
            self.verify_schema()

    def verify_schema(self) -> None:
        for tag in TAG_FIELDS:
            self.execute(f"DESCRIBE TAG {tag};")
        for edge_type in EDGE_FIELDS:
            self.execute(f"DESCRIBE EDGE {edge_type};")

    def wait_for_schema(self) -> None:
        last_error: Exception | None = None
        for _ in range(60):
            try:
                self.verify_schema()
                return
            except RuntimeError as exc:
                last_error = exc
                time.sleep(2)
        raise RuntimeError(f"等待 Schema 同步超时：{last_error}")

    def ensure_indexes(self) -> None:
        schema_path = Path(__file__).with_name("schema.ngql")
        text = "\n".join(
            line for line in schema_path.read_text(encoding="utf-8").splitlines()
            if not line.lstrip().startswith("--")
        )
        statements = [statement.strip() + ";" for statement in text.split(";") if statement.strip()]
        creates = [
            statement for statement in statements
            if statement.lower().startswith("create tag index ")
        ]
        rebuilds = [
            statement for statement in statements
            if statement.lower().startswith("rebuild tag index ")
        ]
        for statement in creates:
            self.execute(statement)
        for statement in rebuilds:
            self._retry(statement, attempts=30, delay=2)

    def _retry(self, statement: str, *, attempts: int, delay: int) -> None:
        last_error: Exception | None = None
        for _ in range(attempts):
            try:
                self.execute(statement)
                return
            except RuntimeError as exc:
                last_error = exc
                time.sleep(delay)
        raise RuntimeError(f"操作重试超时：{last_error}")


def _write_group(
    writer: NebulaWriter,
    groups: dict[str, list[Any]],
    *,
    batch_size: int,
    statement_builder: Any,
    label: str,
) -> int:
    written = 0
    total = sum(len(items) for items in groups.values())
    for schema_name, items in groups.items():
        for chunk in batches(items, batch_size):
            writer._retry(statement_builder(schema_name, chunk), attempts=60, delay=2)
            written += len(chunk)
            print(f"\r{label}: {written:,}/{total:,}", end="", flush=True)
    print()
    return written


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="生成随机金融图并直接写入 NebulaGraph")
    parser.add_argument("--vertices", type=int, default=10_000, help="顶点总数，默认 10000")
    parser.add_argument("--edges", type=int, default=30_000, help="边总数，默认 30000")
    parser.add_argument("--seed", type=int, default=20260910, help="随机种子")
    parser.add_argument("--prefix", default="rnd", help="VID 前缀；相同参数重复执行会覆盖同一批数据")
    parser.add_argument("--space", default=NEBULA_SPACE, help="目标图空间")
    parser.add_argument("--batch-size", type=int, default=200, help="单条 INSERT 包含的记录数")
    parser.add_argument("--dry-run", action="store_true", help="仅生成和预览，不连接数据库")
    parser.add_argument("--init-schema", action="store_true", help="目标图空间不存在时创建并初始化 schema.ngql")
    parser.add_argument("--yes", action="store_true", help="确认直接写入目标图空间")
    return parser.parse_args(argv)


def main(argv: Iterable[str] | None = None) -> int:
    args = parse_args(argv)
    if not 1 <= args.batch_size <= 1_000:
        print("batch-size 必须在 1-1000 之间", file=sys.stderr)
        return 2
    try:
        graph = build_random_graph(
            vertex_count=args.vertices,
            edge_count=args.edges,
            seed=args.seed,
            prefix=args.prefix,
        )
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    print(
        f"已生成：{graph.vertex_count:,} 个顶点，{graph.edge_count:,} 条边，"
        f"seed={args.seed}，prefix={args.prefix}"
    )
    print("顶点分布：" + "，".join(f"{name}={len(items):,}" for name, items in graph.vertices.items()))
    print("边分布：" + "，".join(f"{name}={len(items):,}" for name, items in graph.edges.items()))
    if args.dry_run:
        first_tag = next(name for name, items in graph.vertices.items() if items)
        print("\n首个顶点批次 nGQL 预览：")
        print(vertex_statement(first_tag, graph.vertices[first_tag][:1]))
        return 0
    if not args.yes:
        print("拒绝写入：请检查目标后追加 --yes 明确确认。", file=sys.stderr)
        return 2

    try:
        with NebulaWriter(space=args.space) as writer:
            writer.prepare_space(init_schema=args.init_schema)
            _write_group(
                writer, graph.vertices, batch_size=args.batch_size,
                statement_builder=vertex_statement, label="写入顶点",
            )
            _write_group(
                writer, graph.edges, batch_size=args.batch_size,
                statement_builder=edge_statement, label="写入关系",
            )
            writer.ensure_indexes()
    except Exception as exc:
        print(f"\n写入失败：{exc}", file=sys.stderr)
        return 1

    print(f"写入完成：space={args.space}，顶点={graph.vertex_count:,}，边={graph.edge_count:,}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
