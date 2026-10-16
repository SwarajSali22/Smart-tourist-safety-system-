import { Fragment, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import EmptyState from './EmptyState.jsx';

/**
 * Shared table: optional search, click-to-sort headers, pagination, keyboard-
 * operable expandable rows.
 *
 * columns: [{ key, header, render?(row), sortValue?(row), className? }]
 * Pass `searchText(row)` to enable the search box, `toolbar` for extra filters,
 * `renderExpanded(row)` + `expandedId` + `onRowClick` for expandable rows.
 *
 * SERVER MODE (`manual`): the server already searched / sorted / paginated, so the
 * table shows `rows` exactly as given. Provide `sort={{ key, dir }}` + `onSort(key)`
 * for header clicks and `pagination={{ page, pages, total, pageSize, onPage }}`.
 * The search box is the caller's job (put it in `toolbar`).
 */
function DataTable({
  columns,
  rows,
  rowKey = (r) => r._id,
  searchText,
  searchLabel = 'Search',
  toolbar,
  pageSize = 10,
  emptyIcon,
  emptyTitle = 'Nothing here yet',
  emptyText,
  emptyAction,
  onRowClick,
  expandedId,
  renderExpanded,
  caption,
  manual = false,
  sort: serverSort,
  onSort,
  pagination,
  rowClassName,
}) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState({ key: null, dir: 'asc' });
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    if (manual) return rows;
    const q = query.trim().toLowerCase();
    if (!q || !searchText) return rows;
    return rows.filter((r) => searchText(r).toLowerCase().includes(q));
  }, [rows, query, searchText, manual]);

  const sorted = useMemo(() => {
    if (manual) return filtered;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return filtered;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = col.sortValue(a);
      const bv = col.sortValue(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return av < bv ? -dir : av > bv ? dir : 0;
    });
  }, [filtered, sort, columns, manual]);

  const pageCount = manual ? pagination?.pages || 1 : Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = manual ? (pagination?.page || 1) - 1 : Math.min(page, pageCount - 1);
  const visible = manual ? sorted : sorted.slice(safePage * pageSize, safePage * pageSize + pageSize);
  const totalCount = manual ? pagination?.total ?? sorted.length : sorted.length;
  const goToPage = (p) => (manual ? pagination?.onPage?.(p + 1) : setPage(p));

  function toggleSort(col) {
    if (manual) { if (col.sortKey) onSort?.(col.sortKey); return; }
    if (!col.sortValue) return;
    setPage(0);
    setSort((s) => (s.key === col.key ? { key: col.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: col.key, dir: 'asc' }));
  }

  const showToolbar = searchText || toolbar;

  return (
    <div className="data-table-block">
      {showToolbar && (
        <div className="table-toolbar">
          {searchText && (
            <label className="search-box">
              <Search size={16} aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setPage(0); }}
                placeholder={searchLabel}
                aria-label={searchLabel}
              />
            </label>
          )}
          {toolbar}
        </div>
      )}

      {rows.length === 0 && (!manual || !pagination || pagination.total === 0) ? (
        <EmptyState icon={emptyIcon} title={emptyTitle} action={emptyAction}>{emptyText}</EmptyState>
      ) : sorted.length === 0 && !manual ? (
        <EmptyState title="No matches">Try a different search or clear the filters.</EmptyState>
      ) : (
        <>
          <div className="table-wrap">
            <table className="data-table">
              {caption && <caption className="sr-only">{caption}</caption>}
              <thead>
                <tr>
                  {columns.map((c) => {
                    const cur = manual ? serverSort : sort;
                    const sortable = manual ? Boolean(c.sortKey) : Boolean(c.sortValue);
                    const active = manual ? cur?.key === c.sortKey : sort.key === c.key;
                    return (
                      <th
                        key={c.key}
                        scope="col"
                        aria-sort={active ? (cur?.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                      >
                        {sortable ? (
                          <button type="button" className="th-sort" onClick={() => toggleSort(c)}>
                            {c.header}
                            {active && (cur?.dir === 'asc' ? <ArrowUp size={12} aria-hidden="true" /> : <ArrowDown size={12} aria-hidden="true" />)}
                          </button>
                        ) : (
                          c.header
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => {
                  const key = rowKey(row);
                  const expandable = Boolean(onRowClick);
                  const expanded = expandedId === key;
                  return (
                    <Fragment key={key}>
                      <tr
                        className={[expandable ? 'row-clickable' : '', rowClassName?.(row) || ''].join(' ').trim() || undefined}
                        onClick={expandable ? () => onRowClick(row) : undefined}
                        onKeyDown={
                          expandable
                            ? (e) => {
                                if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
                                  e.preventDefault();
                                  onRowClick(row);
                                }
                              }
                            : undefined
                        }
                        tabIndex={expandable ? 0 : undefined}
                        aria-expanded={expandable && renderExpanded ? expanded : undefined}
                      >
                        {columns.map((c) => (
                          <td key={c.key} className={c.className} data-label={c.header}>
                            {c.render ? c.render(row) : row[c.key] ?? '—'}
                          </td>
                        ))}
                      </tr>
                      {expanded && renderExpanded && (
                        <tr className="row-expanded">
                          <td colSpan={columns.length}>{renderExpanded(row)}</td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {pageCount > 1 && (
            <div className="pagination">
              <span className="form-hint" aria-live="polite">
                {safePage * pageSize + 1}–{Math.min(totalCount, (safePage + 1) * pageSize)} of {totalCount}
              </span>
              <div className="pagination__buttons">
                <button type="button" className="icon-btn" onClick={() => goToPage(safePage - 1)} disabled={safePage === 0} aria-label="Previous page">
                  <ChevronLeft size={18} aria-hidden="true" />
                </button>
                <button type="button" className="icon-btn" onClick={() => goToPage(safePage + 1)} disabled={safePage >= pageCount - 1} aria-label="Next page">
                  <ChevronRight size={18} aria-hidden="true" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default DataTable;
