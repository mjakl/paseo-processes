import type { PluginContext } from "@getpaseo/plugin";
import { ProcessesPanel } from "./main.client";

export default function contribute(plugin: PluginContext) {
  plugin.addWorkspacePanel({
    id: "processes",
    title: "Processes",
    icon: "Activity",
    context: "agent",
    locations: ["workspace", "explorer"],
    Component: ProcessesPanel,
  });
  plugin.addCommandCenterItem({
    id: "open-processes",
    title: "Open background processes",
    icon: "Activity",
    context: "agent",
    onSelect({ openPanel }) {
      openPanel("processes", { location: "explorer" });
    },
  });
  return () => {};
}
