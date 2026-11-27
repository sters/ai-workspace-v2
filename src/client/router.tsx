import type { ComponentType, ReactNode } from "react";
import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  type AnyRoute,
  type RouteComponent,
} from "@tanstack/react-router";
import { AppSidebar } from "@/components/shared/app-sidebar";
import { WorkspaceSidebar } from "@/components/shared/workspace-sidebar";
import { ToastHost } from "@/components/shared/feedback/toast";
import { StatusText } from "@/components/shared/feedback/status-text";

import DashboardPage from "@/app/page";
import NewLayout from "@/app/new/layout";
import NewPage from "@/app/new/page";
import ToolsLayout from "@/app/(tools)/layout";
import CheckUpdatePage from "@/app/(tools)/check-update/page";
import CleanupOperationLogPage from "@/app/(tools)/cleanup/operation-log/page";
import CleanupRepositoryPage from "@/app/(tools)/cleanup/repository/page";
import CleanupWorkspacePage from "@/app/(tools)/cleanup/workspace/page";
import NotificationLogsPage from "@/app/(tools)/notification-logs/page";
import OperationsPage from "@/app/(tools)/operations/page";
import OperationPage from "@/app/(tools)/operations/[id]/page";
import RepoLessonsPage from "@/app/(tools)/repo-lessons/page";
import RunCostsPage from "@/app/(tools)/run-costs/page";
import ScheduledJobsPage from "@/app/(tools)/scheduled-jobs/page";
import AiwSettingsPage from "@/app/(tools)/settings/aiw/page";
import ClaudeAuthPage from "@/app/(tools)/settings/claude/auth/page";
import ClaudeMcpServersPage from "@/app/(tools)/settings/claude/mcp-servers/page";
import ClaudeUsagePage from "@/app/(tools)/settings/claude/usage/page";
import ClaudeVersionPage from "@/app/(tools)/settings/claude/version/page";
import ClaudeSettingsLayout from "@/app/(tools)/settings/claude/settings/layout";
import ClaudeSettingsLocalPage from "@/app/(tools)/settings/claude/settings/local/page";
import ClaudeSettingsProjectPage from "@/app/(tools)/settings/claude/settings/project/page";
import ClaudeSettingsUserPage from "@/app/(tools)/settings/claude/settings/user/page";
import SnippetChatPage from "@/app/(tools)/settings/snippet/chat/page";
import SnippetInitPage from "@/app/(tools)/settings/snippet/init/page";
import SnippetVerifyPage from "@/app/(tools)/settings/snippet/verify/page";
import SuggestionsLayout from "@/app/suggestions/layout";
import SuggestionsPage from "@/app/suggestions/page";
import SuggestionsAggregatePage from "@/app/suggestions/aggregate/page";
import SuggestionsDiscoverPage from "@/app/suggestions/discover/page";
import SuggestionsPrunePage from "@/app/suggestions/prune/page";
import WorkspaceLayout from "@/app/workspace/[name]/layout";
import WorkspaceOverviewPage from "@/app/workspace/[name]/page";
import WorkspaceArtifactsPage from "@/app/workspace/[name]/artifacts/page";
import WorkspaceChangesPage from "@/app/workspace/[name]/changes/page";
import ChatLayout from "@/app/workspace/[name]/chat/layout";
import ChatInteractivePage from "@/app/workspace/[name]/chat/interactive/page";
import WorkspaceHistoryPage from "@/app/workspace/[name]/history/page";
import WorkspaceMemoPage from "@/app/workspace/[name]/memo/page";
import WorkspaceOperationsPage from "@/app/workspace/[name]/operations/page";
import WorkspacePullRequestsPage from "@/app/workspace/[name]/pull-requests/page";
import WorkspaceResearchPage from "@/app/workspace/[name]/research/page";
import ReviewLayout from "@/app/workspace/[name]/review/layout";
import ReviewPage from "@/app/workspace/[name]/review/page";
import ReviewTimestampPage from "@/app/workspace/[name]/review/[timestamp]/page";
import WorkspaceTodoPage from "@/app/workspace/[name]/todo/page";
import WorkspaceVerifyPage from "@/app/workspace/[name]/verify/page";

type Layout = ComponentType<{ children: ReactNode }>;

function withOutlet(Layout: Layout) {
  return function LayoutWithOutlet() {
    return (
      <Layout>
        <Outlet />
      </Layout>
    );
  };
}

function page(parent: AnyRoute, path: string, component: RouteComponent) {
  return createRoute({ getParentRoute: () => parent, path, component });
}

const rootRoute = createRootRoute({
  component: () => (
    <>
      <div className="flex min-h-screen">
        <AppSidebar />
        <WorkspaceSidebar />
        {/* The reading-width constraint belongs to each section's own layout,
            since the workspace detail pages want the full width. */}
        <main className="min-w-0 flex-1 overflow-auto">
          <div className="p-6">
            <Outlet />
          </div>
        </main>
      </div>
      <ToastHost />
    </>
  ),
  notFoundComponent: () => <StatusText>Page not found.</StatusText>,
});

const toolsRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "tools",
  component: withOutlet(ToolsLayout),
});

const claudeSettingsRoute = createRoute({
  getParentRoute: () => toolsRoute,
  path: "settings/claude/settings",
  component: withOutlet(ClaudeSettingsLayout),
});

const suggestionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "suggestions",
  component: withOutlet(SuggestionsLayout),
});

const workspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "workspace/$name",
  component: withOutlet(WorkspaceLayout),
});

const chatRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "chat",
  component: withOutlet(ChatLayout),
});

const reviewRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "review",
  component: withOutlet(ReviewLayout),
});

const routeTree = rootRoute.addChildren([
  page(rootRoute, "/", DashboardPage),
  page(rootRoute, "new", () => (
    <NewLayout>
      <NewPage />
    </NewLayout>
  )),
  toolsRoute.addChildren([
    page(toolsRoute, "check-update", CheckUpdatePage),
    page(toolsRoute, "cleanup/operation-log", CleanupOperationLogPage),
    page(toolsRoute, "cleanup/repository", CleanupRepositoryPage),
    page(toolsRoute, "cleanup/workspace", CleanupWorkspacePage),
    page(toolsRoute, "notification-logs", NotificationLogsPage),
    page(toolsRoute, "operations", OperationsPage),
    page(toolsRoute, "operations/$id", OperationPage),
    page(toolsRoute, "repo-lessons", RepoLessonsPage),
    page(toolsRoute, "run-costs", RunCostsPage),
    page(toolsRoute, "scheduled-jobs", ScheduledJobsPage),
    page(toolsRoute, "settings/aiw", AiwSettingsPage),
    page(toolsRoute, "settings/claude/auth", ClaudeAuthPage),
    page(toolsRoute, "settings/claude/mcp-servers", ClaudeMcpServersPage),
    page(toolsRoute, "settings/claude/usage", ClaudeUsagePage),
    page(toolsRoute, "settings/claude/version", ClaudeVersionPage),
    claudeSettingsRoute.addChildren([
      createRoute({
        getParentRoute: () => claudeSettingsRoute,
        path: "/",
        beforeLoad: () => {
          throw redirect({ href: "/settings/claude/settings/project", replace: true });
        },
      }),
      page(claudeSettingsRoute, "local", ClaudeSettingsLocalPage),
      page(claudeSettingsRoute, "project", ClaudeSettingsProjectPage),
      page(claudeSettingsRoute, "user", ClaudeSettingsUserPage),
    ]),
    page(toolsRoute, "settings/snippet/chat", SnippetChatPage),
    page(toolsRoute, "settings/snippet/init", SnippetInitPage),
    page(toolsRoute, "settings/snippet/verify", SnippetVerifyPage),
  ]),
  suggestionsRoute.addChildren([
    page(suggestionsRoute, "/", SuggestionsPage),
    page(suggestionsRoute, "aggregate", SuggestionsAggregatePage),
    page(suggestionsRoute, "discover", SuggestionsDiscoverPage),
    page(suggestionsRoute, "prune", SuggestionsPrunePage),
  ]),
  workspaceRoute.addChildren([
    page(workspaceRoute, "/", WorkspaceOverviewPage),
    page(workspaceRoute, "artifacts", WorkspaceArtifactsPage),
    page(workspaceRoute, "changes", WorkspaceChangesPage),
    chatRoute.addChildren([page(chatRoute, "interactive", ChatInteractivePage)]),
    page(workspaceRoute, "history", WorkspaceHistoryPage),
    page(workspaceRoute, "memo", WorkspaceMemoPage),
    page(workspaceRoute, "operations", WorkspaceOperationsPage),
    page(workspaceRoute, "pull-requests", WorkspacePullRequestsPage),
    page(workspaceRoute, "research", WorkspaceResearchPage),
    reviewRoute.addChildren([
      page(reviewRoute, "/", ReviewPage),
      page(reviewRoute, "$timestamp", ReviewTimestampPage),
    ]),
    page(workspaceRoute, "todo", WorkspaceTodoPage),
    page(workspaceRoute, "verify", WorkspaceVerifyPage),
  ]),
]);

export const router = createRouter({
  routeTree,
  scrollRestoration: true,
  // A route is mounted afresh when a param in its own path changes, so a page
  // never carries one workspace's, review's or operation's state (a chat
  // session, a typed instruction) over to the next. Layouts above the changed
  // segment stay mounted.
  defaultRemountDeps: ({ routeId, params }) =>
    (routeId as string).match(/\$\w+/g)?.map((key) => (params as Record<string, string>)[key.slice(1)]),
  // Query strings stay plain strings, read and written as `URLSearchParams`.
  parseSearch: (search) => Object.fromEntries(new URLSearchParams(search)),
  stringifySearch: (search) => {
    const query = new URLSearchParams(search as Record<string, string>).toString();
    return query ? `?${query}` : "";
  },
});
