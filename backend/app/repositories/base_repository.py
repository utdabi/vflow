# base_repository.py
# Feature 1.1: Organizations & Setup Links
# Abstract base class for all data-access repositories.
# Wraps the Supabase client with common CRUD helpers.
# Using the repository pattern means we can swap Supabase for another
# persistence layer (e.g., a CRM connector) in the future without touching
# business logic or router code.

from abc import ABC
from typing import Any
from supabase import Client


class BaseRepository(ABC):
    """
    All repositories inherit from this class and receive a Supabase client
    at construction time. The table name must be set by the subclass.
    """

    def __init__(self, client: Client, table: str) -> None:
        self._client = client
        self._table = table

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _get_by_id(self, record_id: str) -> dict | None:
        """Return a single row by primary key, or None if not found."""
        response = (
            self._client.table(self._table)
            .select("*")
            .eq("id", record_id)
            .maybe_single()
            .execute()
        )
        return response.data

    def _create(self, data: dict[str, Any]) -> dict:
        """Insert a row and return the created record."""
        response = (
            self._client.table(self._table).insert(data).execute()
        )
        return response.data[0]

    def _update(self, record_id: str, data: dict[str, Any]) -> dict:
        """Update a row by primary key and return the updated record."""
        response = (
            self._client.table(self._table)
            .update(data)
            .eq("id", record_id)
            .execute()
        )
        return response.data[0]

    def _delete(self, record_id: str) -> None:
        """Hard-delete a row by primary key."""
        self._client.table(self._table).delete().eq("id", record_id).execute()

    def _list(
        self,
        filters: dict[str, Any] | None = None,
        order_by: str | None = None,
        ascending: bool = True,
    ) -> list[dict]:
        """
        Return all rows optionally filtered and sorted.
        filters: {column: value} pairs (all ANDed together as .eq() calls)
        order_by: column name to sort by
        """
        query = self._client.table(self._table).select("*")
        if filters:
            for column, value in filters.items():
                query = query.eq(column, value)
        if order_by:
            query = query.order(order_by, desc=not ascending)
        return query.execute().data
