"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";

export function NavMain({
  items,
  label,
}: {
  label?: string;
  items: { title: string; url: string; icon: React.ReactNode }[];
}) {
  const pathname = usePathname();
  return (
    <SidebarGroup>
      {label ? <SidebarGroupLabel className="text-[10px] tracking-wide uppercase">{label}</SidebarGroupLabel> : null}
      <SidebarMenu>
        {items.map((item) => {
          const active = item.url === "/" ? pathname === "/" : pathname === item.url || pathname.startsWith(`${item.url}/`) || (item.url === "/review" && pathname === "/import");
          return (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton isActive={active} tooltip={item.title} render={<Link href={item.url} />}>
                {item.icon}
                <span>{item.title}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}
