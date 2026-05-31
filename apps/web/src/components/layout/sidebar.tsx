import Link from "next/link";
import { can } from "@ibirdos/permissions";
import type { Role } from "@ibirdos/permissions";

const NAV_ITEMS: Array<{ href: string; label: string; permission?: string }> = [
  { href: "",            label: "Dashboard" },
  { href: "/insights",   label: "Insights",     permission: "analytics.read" },
  { href: "/events",     label: "Events",       permission: "event.read" },
  { href: "/kitchen",    label: "Kitchen",      permission: "kitchen.read" },
  { href: "/recipes",    label: "Recipes",      permission: "recipe.read" },
  { href: "/ingredients", label: "Ingredients", permission: "ingredient.read" },
  { href: "/inventory",  label: "Inventory",    permission: "inventory.read" },
  { href: "/invoices",   label: "Invoices",     permission: "invoice.read" },
  { href: "/waste-yield", label: "Waste & yield", permission: "waste.read" },
  { href: "/vendors",    label: "Vendors",      permission: "vendor.read" },
  { href: "/billing",    label: "Billing",      permission: "billing.read" },
];

const SETTINGS_ITEMS: Array<{
  href: string;
  label: string;
  roles: Role[];
}> = [
  { href: "/settings",       label: "Settings",    roles: ["OWNER", "MANAGER"] },
  { href: "/settings/users", label: "Team & Roles", roles: ["OWNER"] },
];

export function Sidebar({
  workspaceSlug, workspaceName, role, username,
}: {
  workspaceSlug: string; workspaceName: string; role: Role; username: string;
}) {
  const settingsItems = SETTINGS_ITEMS.filter(item => item.roles.includes(role));

  return (
    <aside className="w-60 shrink-0 border-r border-bg-border bg-bg-surface flex flex-col h-screen sticky top-0">
      <div className="px-5 py-5 border-b border-bg-border">
        <div className="text-[10px] uppercase tracking-wider text-text-tertiary">Workspace</div>
        <div className="mt-1 font-semibold truncate">{workspaceName}</div>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          if (item.permission && !can(role, item.permission as any)) return null;
          return (
            <Link
              key={item.href}
              href={`/${workspaceSlug}${item.href}` as any}
              className="block px-3 py-2 rounded text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
            >
              {item.label}
            </Link>
          );
        })}

        {settingsItems.length > 0 && (
          <div className="pt-3">
            <div className="px-3 pb-1 text-[10px] uppercase tracking-wider text-text-tertiary">Settings</div>
            {settingsItems.map(item => (
              <Link
                key={item.href}
                href={`/${workspaceSlug}${item.href}` as any}
                className="block px-3 py-2 rounded text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
              >
                {item.label}
              </Link>
            ))}
          </div>
        )}
      </nav>
      <div className="px-5 py-4 border-t border-bg-border space-y-2">
        <div className="text-xs">
          <div className="text-text-tertiary">{username}</div>
          <div className="text-[10px] uppercase tracking-wider text-text-tertiary mt-0.5">{role}</div>
        </div>
        <form action="/api/internal/logout" method="POST">
          <button className="text-xs text-text-tertiary hover:text-danger transition-colors w-full text-left">
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
