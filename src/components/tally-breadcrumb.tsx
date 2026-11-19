"use client";

import { Fragment } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";

const labels: Record<string, string> = {
  import: "Import",
  review: "Review",
  customer: "Customers",
  invoice: "Invoice",
  settings: "Settings",
  audit: "Audit",
  driver: "Driver",
};

export function TallyBreadcrumb() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) {
    return <span className="text-sm font-medium">Overview</span>;
  }
  if (segments.length === 1) return <span className="text-sm font-medium">{labels[segments[0]] ?? segments[0]}</span>;
  return (
    <Breadcrumb>
      <BreadcrumbList>
        {segments.map((segment, index) => {
          const href = `/${segments.slice(0, index + 1).join("/")}`;
          const label = labels[segment] ?? segment;
          const last = index === segments.length - 1;
          return (
            <Fragment key={href}>
              {index > 0 ? <BreadcrumbSeparator className="hidden md:block" /> : null}
              <BreadcrumbItem>
                {last ? <BreadcrumbPage>{label}</BreadcrumbPage> : <BreadcrumbLink render={<Link href={href} />}>{label}</BreadcrumbLink>}
              </BreadcrumbItem>
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
