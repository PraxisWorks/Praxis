import { NotificationList } from "../components/NotificationList.js";

type NotificationsProps = {
  repoId?: string | null;
};

export function Notifications({ repoId }: NotificationsProps) {
  return (
    <div className="max-w-[700px] mx-auto">
      <NotificationList repoId={repoId} />
    </div>
  );
}
