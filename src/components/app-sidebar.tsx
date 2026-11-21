"use client";
import Link from "next/link";
import {
  TruckIcon,
  LayoutDashboardIcon,
  ArrowLeftRightIcon,
  UsersIcon,
  SettingsIcon,
  HistoryIcon,
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
  { title: "Deliveries", url: "/deliveries", icon: <TruckIcon /> },
  { title: "Bank credits", url: "/review", icon: <ArrowLeftRightIcon /> },
  { title: "Customers", url: "/customer", icon: <UsersIcon /> },
];
const secondaryItems = [
  { title: "Activity", url: "/audit", icon: <HistoryIcon /> },
  { title: "Settings", url: "/settings", icon: <SettingsIcon /> },
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
        <NavMain items={items} label="Workspace" />
        <NavMain items={secondaryItems} label="Management" />
      </SidebarContent>
    </Sidebar>
  );
}
