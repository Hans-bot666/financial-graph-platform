"""流式生成一百万顶点和三百万条关系并直接写入新 NebulaGraph 图空间。"""
from __future__ import annotations

import argparse
import random
import sys
from datetime import date, timedelta
from typing import Any, Iterable, Iterator

from generate_random_graph import (
    BANKS,
    CITIES,
    EDGE_FIELDS,
    INDUSTRIES,
    POSITIONS,
    TAG_FIELDS,
    EdgeRecord,
    NebulaWriter,
    VertexRecord,
    edge_statement,
    vertex_statement,
)

DEFAULT_SPACE = "random_financial_graph_million"
DEFAULT_PREFIX = "million"
DEFAULT_VERTICES = 1_000_000
DEFAULT_EDGES = 3_000_000


def vertex_counts(total: int) -> dict[str, int]:
    if total < 10:
        raise ValueError("顶点数量至少为 10")
    company = total * 30 // 100
    person = total * 20 // 100
    account = total * 40 // 100
    return {
        "company": company,
        "person": person,
        "account": account,
        "loan": total - company - person - account,
    }


def edge_counts(total: int) -> dict[str, int]:
    if total < 0:
        raise ValueError("边数量不能为负数")
    names = list(EDGE_FIELDS)
    base, remainder = divmod(total, len(names))
    return {name: base + (1 if index < remainder else 0) for index, name in enumerate(names)}


def _event_date(rng: random.Random, start: date, days: int) -> str:
    return (start + timedelta(days=rng.randrange(days))).isoformat()


def vertex_id(prefix: str, tag: str, index: int) -> str:
    marker = {"company": "c", "person": "p", "account": "a", "loan": "l"}[tag]
    return f"{prefix}_{marker}_{index:07d}"


def iter_vertices(tag: str, count: int, *, seed: int, prefix: str) -> Iterator[VertexRecord]:
    rng = random.Random(seed + {"company": 11, "person": 23, "account": 37, "loan": 53}[tag])
    for index in range(count):
        vid = vertex_id(prefix, tag, index)
        if tag == "company":
            is_lost = rng.random() < 0.025
            values = (
                f"百万图企业{index:07d}有限公司",
                f"92{seed % 10_000:04d}{index:012d}"[-18:],
                rng.choice(INDUSTRIES),
                round(rng.uniform(1_000_000, 500_000_000), 2),
                _event_date(rng, date(1985, 1, 1), 14_000),
                f"{rng.choice(CITIES)}百万图测试路{rng.randrange(1, 9999)}号",
                f"0{rng.randrange(10, 99)}-{rng.randrange(10_000_000, 99_999_999)}",
                rng.randrange(0, 101),
                is_lost,
                rng.randrange(30, 366) if is_lost else 0,
            )
        elif tag == "person":
            values = (
                f"百万图人员{index:07d}",
                f"320101{rng.randrange(1960, 2003)}{rng.randrange(1, 13):02d}{rng.randrange(1, 29):02d}{index:04d}"[-18:],
                f"1{rng.randrange(30, 99)}{rng.randrange(0, 100_000_000):08d}",
                f"{rng.choice(CITIES)}百万图社区{rng.randrange(1, 9999)}号",
                rng.randrange(0, 101),
            )
        elif tag == "account":
            values = (
                f"百万图账户{index:07d}",
                f"63{seed % 10_000:04d}{index:013d}"[-19:],
                rng.choice(BANKS),
                _event_date(rng, date(2005, 1, 1), 7_300),
                rng.randrange(0, 101),
            )
        else:
            issue = date(2020, 1, 1) + timedelta(days=rng.randrange(2_000))
            values = (
                f"百万图流动资金贷款{index:07d}",
                f"MDK-{seed}-{index:07d}",
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
    prefix: str,
) -> Iterator[EdgeRecord]:
    type_index = list(EDGE_FIELDS).index(edge_type)
    rng = random.Random(seed + 10_000 + type_index * 997)
    start = date(2022, 1, 1)

    def pick(tag: str) -> str:
        return vertex_id(prefix, tag, rng.randrange(vertex_totals[tag]))

    def different(tag: str) -> tuple[str, str]:
        source_index = rng.randrange(vertex_totals[tag])
        target_index = rng.randrange(vertex_totals[tag] - 1)
        if target_index >= source_index:
            target_index += 1
        return vertex_id(prefix, tag, source_index), vertex_id(prefix, tag, target_index)

    for index in range(count):
        rank = index + 1
        event_date = _event_date(rng, start, 1_700)
        if edge_type == "holds_account":
            source, target = pick("company"), pick("account")
            values = (event_date, rng.choice(("基本户", "一般户", "结算户")))
        elif edge_type == "applied_for":
            source = pick("company") if rng.random() < 0.9 else pick("person")
            target = pick("loan")
            values = (event_date, round(rng.uniform(100_000, 50_000_000), 2))
        elif edge_type == "disbursed_to":
            source, target = pick("loan"), pick("account")
            values = (event_date, round(rng.uniform(100_000, 50_000_000), 2))
        elif edge_type == "transfer":
            source, target = different("account")
            values = (
                f"{event_date} {rng.randrange(0, 24):02d}:{rng.randrange(0, 60):02d}:00",
                round(rng.uniform(100, 10_000_000), 2),
                "CNY",
                rng.choice(("货款", "往来款", "服务费", "借款", "投资款", "其他")),
                rng.choice(("网银", "柜面", "手机银行", "跨行转账")),
            )
        elif edge_type == "guarantees":
            source, target = different("company")
            values = (
                event_date,
                round(rng.uniform(100_000, 100_000_000), 2),
                rng.choice(("连带责任保证", "一般保证", "抵押担保")),
            )
        elif edge_type == "controls":
            source, target = pick("person"), pick("company")
            values = (
                rng.choice(("实际控制人", "法定代表人", "一致行动人")),
                round(rng.uniform(0.05, 0.95), 4),
                event_date,
            )
        elif edge_type == "shareholder":
            source = pick("person") if rng.random() < 0.7 else pick("company")
            target = pick("company")
            values = (round(rng.uniform(0.01, 0.9), 4), round(rng.uniform(100_000, 100_000_000), 2))
        elif edge_type == "employs":
            source, target = pick("person"), pick("company")
            values = (rng.choice(POSITIONS), event_date)
        else:
            tag = "company" if rng.random() < 0.7 else "person"
            source, target = different(tag)
            values = (
                rng.choice(("上下游", "同一地址", "亲属", "交易对手", "共同联系人")),
                rng.choice(("工商", "交易流水", "公开信息", "测试生成")),
                event_date,
            )
        yield EdgeRecord(edge_type, source, target, rank, values)


def _chunks(records: Iterable[Any], size: int) -> Iterator[list[Any]]:
    chunk: list[Any] = []
    for record in records:
        chunk.append(record)
        if len(chunk) == size:
            yield chunk
            chunk = []
    if chunk:
        yield chunk


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
    builder = edge_statement if is_edge else vertex_statement
    for chunk in _chunks(records, batch_size):
        writer._retry(builder(schema_name, chunk), attempts=60, delay=2)
        written += len(chunk)
        if written % 50_000 == 0 or written == total:
            print(f"  {schema_name}: {written:,}/{total:,}", flush=True)


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="流式生成百万级金融图并直接写入新 NebulaGraph 图空间")
    parser.add_argument("--space", default=DEFAULT_SPACE)
    parser.add_argument("--vertices", type=int, default=DEFAULT_VERTICES)
    parser.add_argument("--edges", type=int, default=DEFAULT_EDGES)
    parser.add_argument("--seed", type=int, default=20260910)
    parser.add_argument("--prefix", default=DEFAULT_PREFIX)
    parser.add_argument("--batch-size", type=int, default=500)
    parser.add_argument("--partitions", type=int, default=50)
    parser.add_argument("--resume", action="store_true", help="允许在已存在图空间中幂等重写同一批数据")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--yes", action="store_true")
    return parser.parse_args(argv)


def main(argv: Iterable[str] | None = None) -> int:
    args = parse_args(argv)
    if args.space == "anti_fraud_kg":
        print("拒绝使用现有 anti_fraud_kg，请指定独立图空间。", file=sys.stderr)
        return 2
    if not 1 <= args.batch_size <= 1_000:
        print("batch-size 必须在 1-1000 之间。", file=sys.stderr)
        return 2
    if not 1 <= args.partitions <= 1_024:
        print("partitions 必须在 1-1024 之间。", file=sys.stderr)
        return 2
    if not args.prefix.replace("_", "").replace("-", "").isalnum() or len(args.prefix) > 20:
        print("prefix 格式非法。", file=sys.stderr)
        return 2
    try:
        vertices_by_type = vertex_counts(args.vertices)
        edges_by_type = edge_counts(args.edges)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    print(f"目标：space={args.space}，vertices={args.vertices:,}，edges={args.edges:,}")
    print("顶点分布：" + "，".join(f"{key}={value:,}" for key, value in vertices_by_type.items()))
    print("关系分布：" + "，".join(f"{key}={value:,}" for key, value in edges_by_type.items()))
    if args.dry_run:
        for tag in TAG_FIELDS:
            sample = next(iter_vertices(tag, 1, seed=args.seed, prefix=args.prefix))
            print(vertex_statement(tag, [sample]).splitlines()[-1])
        return 0
    if not args.yes:
        print("拒绝写入：请追加 --yes 明确确认。", file=sys.stderr)
        return 2

    try:
        with NebulaWriter(space=args.space) as writer:
            exists = True
            try:
                writer.execute(f"USE {args.space};")
            except RuntimeError as exc:
                if "SpaceNotFound" not in str(exc):
                    raise
                exists = False
            if exists and not args.resume:
                raise RuntimeError("目标图空间已存在；确认继续时请追加 --resume")
            writer.prepare_space(init_schema=True, partition_num=args.partitions)

            print("开始写入顶点：")
            for tag, count in vertices_by_type.items():
                write_stream(
                    writer,
                    schema_name=tag,
                    records=iter_vertices(tag, count, seed=args.seed, prefix=args.prefix),
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
                        edge_type,
                        count,
                        vertex_totals=vertices_by_type,
                        seed=args.seed,
                        prefix=args.prefix,
                    ),
                    total=count,
                    batch_size=args.batch_size,
                    is_edge=True,
                )
            writer.ensure_indexes()
    except Exception as exc:
        print(f"导入失败：{exc}", file=sys.stderr)
        return 1

    print(f"导入完成：{args.vertices:,} 个顶点，{args.edges:,} 条关系。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
