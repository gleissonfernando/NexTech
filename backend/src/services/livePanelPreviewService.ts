export type LivePanelPreviewDto = {
  platform: "twitch" | "kick";
  dataSource: "live" | "simulated";
  mention: string | null;
  color: string;
  authorName: string;
  authorIconUrl: string | null;
  title: string;
  url: string;
  description: string;
  fields: Array<{
    name: string;
    value: string;
    inline: boolean;
  }>;
  imageUrl: string | null;
  footer: string;
  buttonLabel: string;
};
