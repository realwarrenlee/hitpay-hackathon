"use client";
import Link from "next/link";
import {
  LayoutDashboardIcon,
  UploadIcon,
  ListChecksIcon,
  UsersIcon,
  SettingsIcon,
  ScrollTextIcon,
} from "lucide-react";
import { TallyLogo } from "@/components/tally-logo";
import { NavMain } from "@/components/nav-main";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
const items = [
  { title: "Overview", url: "/", icon: <LayoutDashboardIcon /> },
  { title: "Import", url: "/import", icon: <UploadIcon /> },
  { title: "Review", url: "/review", icon: <ListChecksIcon /> },
  { title: "Customers", url: "/customer", icon: <UsersIcon /> },
  { title: "Settings", url: "/settings", icon: <SettingsIcon /> },
  { title: "Audit", url: "/audit", icon: <ScrollTextIcon /> },
];
export function AppSidebar() {
  return (
    <Sidebar variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              render={<Link href="/" aria-label="Tally home" />}
            >
              <TallyLogo />
              <span className="truncate font-semibold">Tally</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={items} />
      </SidebarContent>
    </Sidebar>
  );
}
