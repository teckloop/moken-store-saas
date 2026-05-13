import type { Request, Response, NextFunction } from "express";
import type { Tenant } from "@moken-store/shared";
import { db } from "./db.js";

declare global {
  namespace Express {
    interface Request {
      tenant?: Tenant;
    }
  }
}

type TenantRow = {
  id: string;
  name: string;
  slug: string;
  primary_domain: string;
  status: Tenant["status"];
  theme_json: string;
};

function normalizeDomain(value: string) {
  return value.toLowerCase().split(":")[0] ?? value.toLowerCase();
}

function rowToTenant(row: TenantRow): Tenant {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    primaryDomain: row.primary_domain,
    status: row.status,
    theme: JSON.parse(row.theme_json)
  };
}

function resolveTenantById(tenantId: string) {
  return db.prepare("select * from tenants where id = ?").get(tenantId) as TenantRow | undefined;
}

function resolveTenantByDomain(domain: string) {
  return db.prepare(`
    select t.*
    from tenants t
    left join tenant_domains d on d.tenant_id = t.id
    where d.domain = ? or t.primary_domain = ?
    limit 1
  `).get(domain, domain) as TenantRow | undefined;
}

export function resolveTenant(req: Request, res: Response, next: NextFunction) {
  const requestedDomain = normalizeDomain(String(req.header("x-store-domain") || req.hostname || "demo.localhost"));
  const row = req.user?.role !== "platform_owner" && req.user?.tenantId
    ? resolveTenantById(req.user.tenantId)
    : resolveTenantByDomain(requestedDomain);

  if (!row) {
    res.status(404).json({
      error: "store_not_found",
      message: `No store is configured for domain ${requestedDomain}`
    });
    return;
  }

  if (row.status !== "active") {
    res.status(423).json({
      error: "store_paused",
      message: "This store is currently paused."
    });
    return;
  }

  req.tenant = rowToTenant(row);
  next();
}
