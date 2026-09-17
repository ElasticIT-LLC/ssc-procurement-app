# Procurement reporting queries

`app_procurement.line_items` is the **per-item-order fact table**: one row per item order,
whether it came from a new request or a pre-approved re-order (see
`docs/superpowers/specs/2026-08-27-phase3-design.md`, B4). After Wave B (v0.25.0) every
lifecycle stage has a timestamp, so the client can run requested/ordered/re-ordered reports
against one table.

## Stage → source column

| Stage | Source |
|---|---|
| Requested | `line_items.created_at` / `purchase_requests.submitted_at` |
| Decision (approve/decline/hold) | `line_items.approval_date` (stamped for all decisions) |
| Ordered | `line_items.date_purchased` + `purchase_orders` (PO #, vendor, ETA) via `line_items.po_id` |
| Received | `line_items.received_at` |
| Returned | `line_items.return_date` → processed: `return_processed_at` |
| Cancelled / archived | `line_items.cancelled_at` / `line_items.archived_at` |
| Re-order linkage | `line_items.pre_approved_item_id` → catalog; `pre_approved_items.source_line_item_id` → original item |

> **Backfill gap:** `received_at` / `cancelled_at` only exist for rows stamped after the
> migration (v0.25.0). For those two stages, historical rows can be approximated with
> `updated_at`/`eta` and `status` respectively. `approval_date` and `date_purchased` are
> fully historical.

## Example queries (run via `supabase db query "<sql>" --linked`)

### 1. All items ever requested

```sql
SELECT li.created_at AS requested_at,
       pr.request_number,
       pr.requester_name,
       li.item_description,
       li.quantity,
       li.status
FROM app_procurement.line_items li
JOIN app_procurement.purchase_requests pr ON pr.id = li.request_id
ORDER BY li.created_at;
```

### 2. All items ordered (with PO)

```sql
SELECT li.date_purchased AS ordered_at,
       po.po_number,
       po.vendor,
       po.eta,
       li.item_description,
       li.quantity
FROM app_procurement.line_items li
JOIN app_procurement.purchase_orders po ON po.id = li.po_id
WHERE li.po_id IS NOT NULL
ORDER BY li.date_purchased DESC NULLS LAST;
```

### 3. Re-order count per pre-approved item

```sql
SELECT cat.name,
       count(*)::int AS order_count,
       min(li.created_at) AS first_order,
       max(li.created_at) AS last_order
FROM app_procurement.pre_approved_items cat
JOIN app_procurement.line_items li ON li.pre_approved_item_id = cat.id
GROUP BY cat.name
ORDER BY order_count DESC;
```

### 4. Items requested but never ordered (with age)

```sql
SELECT li.created_at AS requested_at,
       pr.request_number,
       li.item_description,
       li.status,
       (now() - li.created_at) AS age
FROM app_procurement.line_items li
JOIN app_procurement.purchase_requests pr ON pr.id = li.request_id
WHERE li.status IN ('pending', 'approved', 'on_hold')
ORDER BY li.created_at;
```

## Records CSV

The admin Records page "Export CSV" button includes the reporting columns
`Received`, `Cancelled`, `Pre-approved Item`, and `Source Item` (the `#<requestNo>-<lineNo>`
reference of the line item a catalog entry was pre-approved from).
