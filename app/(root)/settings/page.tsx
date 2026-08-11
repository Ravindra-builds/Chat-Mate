import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { SettingsView } from "@/features/settings/components/settings-view";

export default function SettingsPage() {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3">
        <SidebarTrigger />
        <Separator orientation="vertical" className="mx-1 h-4" />
        <h1 className="text-sm font-medium">Settings</h1>
      </header>
      <div className="flex-1 overflow-y-auto">
        <SettingsView />
      </div>
    </div>
  );
}