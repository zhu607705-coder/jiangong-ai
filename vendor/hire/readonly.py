"""HIRE PostgresQueryExecutor selective port (MIT).

Keeps the cursor execution/header/row contract. Removes all credentials,
connection creation, commits and swallowed errors. The caller owns a scoped,
read-only connection; the local table adapter supplies an in-memory database.
"""
import sqlite3
import sqlglot
from sqlglot import exp


def validate_readonly(sql: str) -> None:
    if len(sql) > 4096:
        raise ValueError("Query length exceeds budget")
    statements = sqlglot.parse(sql, read="sqlite")
    if len(statements) != 1 or not isinstance(statements[0], exp.Select):
        raise ValueError("Only one SELECT statement is allowed")
    tree = statements[0]
    if any(tree.find(t) for t in (exp.Insert, exp.Update, exp.Delete, exp.Create, exp.Drop, exp.Command, exp.Into)):
        raise ValueError("Mutation is forbidden")
    if any(t.name != "evidence" for t in tree.find_all(exp.Table)):
        raise ValueError("Only the scoped evidence table is visible")
    if any(f.name.lower() in {"load_extension", "readfile", "writefile"} for f in tree.find_all(exp.Anonymous)):
        raise ValueError("File and extension functions are forbidden")


class ReadonlyQueryExecutor:
    def __init__(self, connection: sqlite3.Connection):
        self.conn = connection
        self.conn.execute("PRAGMA query_only = ON")
        self.cur = self.conn.cursor()

    def execute_sql(self, sql_statement: str, parameters: tuple = (), max_rows: int = 100):
        validate_readonly(sql_statement)
        remaining = 100
        def budget():
            nonlocal remaining
            remaining -= 1
            return int(remaining <= 0)
        self.conn.set_progress_handler(budget, 1000)
        try:
            self.cur.execute(sql_statement, parameters)
            result = self.cur.fetchmany(min(max_rows, 100))
            headers = [desc[0] for desc in self.cur.description]
            return headers, result
        finally:
            self.conn.set_progress_handler(None, 0)

    def close(self):
        self.cur.close()
        self.conn.close()
