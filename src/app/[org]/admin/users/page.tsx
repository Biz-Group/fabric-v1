"use client";

import {
  useAction,
  useMutation,
  usePaginatedQuery,
  useQuery,
} from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  EditPlacementDialog,
  groupDepartments,
  type PlacementMember,
} from "@/features/admin/edit-placement-dialog";
import { InviteMemberDialog } from "@/features/admin/invite-member-dialog";
import { PendingInvitesList } from "@/features/admin/pending-invites-list";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useLastLoaded } from "@/hooks/use-last-loaded";
import { describeError } from "@/lib/user-error-message";
import { cn } from "@/lib/utils";
import { MoreHorizontal, Search, UserPlus, X } from "lucide-react";

const ROLE_OPTIONS = ["admin", "contributor", "viewer"] as const;
type Role = (typeof ROLE_OPTIONS)[number];
type RoleFilter = "all" | Role;
type DepartmentFilter = "all" | "unplaced" | Id<"departments">;
type MemberRow = FunctionReturnType<
  typeof api.users.listOrgMembersPage
>["page"][number];

// Matches the server's cap on bulk role changes and removals.
const MAX_BULK_MEMBERS = 50;

const ROLE_FILTERS: { value: RoleFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "admin", label: "Admins" },
  { value: "contributor", label: "Contributors" },
  { value: "viewer", label: "Viewers" },
];

// Secondary columns drop out on narrower screens so the name, role and row
// actions always fit. Header and cells share these, so a hidden column never
// leaves its header behind.
const COLUMN_CLASS = {
  jobTitle: "hidden xl:table-cell",
  department: "hidden md:table-cell",
  platform: "hidden xl:table-cell",
  profile: "hidden sm:table-cell",
  joined: "hidden xl:table-cell",
};

const roleBadgeVariant: Record<Role, "default" | "secondary" | "outline"> = {
  admin: "default",
  contributor: "secondary",
  viewer: "outline",
};

function requiresConfirm(current: Role, next: Role): boolean {
  return next === "admin" || current === "admin";
}

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function RoleSelect({
  membershipId,
  currentRole,
  isSelf,
  memberName,
}: {
  membershipId: Id<"memberships">;
  currentRole: Role;
  isSelf: boolean;
  memberName: string;
}) {
  const setMembershipRole = useMutation(api.users.setMembershipRole);
  const [pendingRole, setPendingRole] = useState<Role | null>(null);
  const [busy, setBusy] = useState(false);

  const applyChange = async (nextRole: Role) => {
    setBusy(true);
    try {
      await setMembershipRole({ membershipId, role: nextRole });
      toast.success(`Role updated to ${nextRole}.`);
    } catch (err) {
      toast.error(describeError(err, "Failed to change role."));
    } finally {
      setBusy(false);
      setPendingRole(null);
    }
  };

  const handleChange = async (value: Role) => {
    if (value === currentRole) return;
    if (requiresConfirm(currentRole, value)) {
      setPendingRole(value);
      return;
    }
    await applyChange(value);
  };

  if (isSelf) {
    return (
      <Badge variant={roleBadgeVariant[currentRole]} className="capitalize">
        {currentRole}
      </Badge>
    );
  }

  return (
    <>
      <Select
        value={currentRole}
        onValueChange={(val) => handleChange(val as Role)}
        disabled={busy}
      >
        <SelectTrigger
          size="sm"
          className="w-[130px]"
          aria-label={`Role for ${memberName}`}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ROLE_OPTIONS.map((role) => (
            <SelectItem key={role} value={role} className="capitalize">
              {role}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <ConfirmDialog
        open={pendingRole !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRole(null);
        }}
        title={
          pendingRole === "admin"
            ? `Promote ${memberName} to admin?`
            : `Change ${memberName}'s role to ${pendingRole}?`
        }
        description={
          pendingRole === "admin"
            ? "Admins can manage members, invitations, and conversations across the workspace."
            : "This member will lose admin privileges."
        }
        confirmLabel="Change role"
        destructive={currentRole === "admin" && pendingRole !== "admin"}
        onConfirm={async () => {
          if (pendingRole) await applyChange(pendingRole);
        }}
      />
    </>
  );
}

function RowActions({
  member,
  isSelf,
  onEditPlacement,
}: {
  member: MemberRow;
  isSelf: boolean;
  onEditPlacement: () => void;
}) {
  const removeMember = useAction(api.users.removeMemberFromOrg);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleRemove = async () => {
    try {
      await removeMember({ membershipId: member.membershipId });
      toast.success(`Removed ${member.name} from the workspace.`);
    } catch (err) {
      toast.error(describeError(err, "Failed to remove member."));
      throw err;
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" />}
        >
          <MoreHorizontal />
          <span className="sr-only">Actions for {member.name}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onEditPlacement}>
            Edit placement
          </DropdownMenuItem>
          {!isSelf && (
            <DropdownMenuItem
              variant="destructive"
              onClick={() => setConfirmOpen(true)}
            >
              Remove from workspace
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Remove ${member.name}?`}
        description="They will immediately lose access to this workspace and will be removed from the Clerk organization. They can be re-invited later."
        confirmLabel="Remove member"
        destructive
        onConfirm={handleRemove}
      />
    </>
  );
}

/** Bulk role change and removal for the selected rows. */
function BulkActions({
  selected,
  onClear,
}: {
  selected: MemberRow[];
  onClear: () => void;
}) {
  const setMembershipRoles = useMutation(api.users.setMembershipRoles);
  const removeMembers = useAction(api.users.removeMembersFromOrg);
  const [pendingRole, setPendingRole] = useState<Role | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const count = selected.length;
  const tooMany = count > MAX_BULK_MEMBERS;
  const demotesAdmins = selected.some((member) => member.role === "admin");

  const applyRole = async (role: Role) => {
    try {
      const { changed } = await setMembershipRoles({
        membershipIds: selected.map((member) => member.membershipId),
        role,
      });
      toast.success(
        changed === 0
          ? `Everyone selected is already a ${role}.`
          : `Changed ${plural(changed, "member")} to ${role}.`,
      );
      onClear();
    } catch (err) {
      toast.error(describeError(err, "Failed to change roles."));
      throw err;
    }
  };

  const remove = async () => {
    try {
      const { removed, failed } = await removeMembers({
        membershipIds: selected.map((member) => member.membershipId),
      });
      if (removed.length > 0) {
        toast.success(`Removed ${plural(removed.length, "member")}.`);
      }
      if (failed.length > 0) {
        const names = new Map(
          selected.map((member) => [member.membershipId, member.name]),
        );
        const [first] = failed;
        toast.error(
          `${plural(failed.length, "member")} couldn't be removed. ${names.get(first.membershipId) ?? "One member"}: ${first.message}`,
        );
      }
      onClear();
    } catch (err) {
      toast.error(describeError(err, "Failed to remove members."));
      throw err;
    }
  };

  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2"
    >
      <p className="mr-auto text-sm font-medium">
        {plural(count, "member")} selected
        {tooMany && (
          <span className="ml-2 font-normal text-muted-foreground">
            Select up to {MAX_BULK_MEMBERS} at a time.
          </span>
        )}
      </p>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="outline" size="sm" disabled={tooMany} />}
        >
          Change role
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {ROLE_OPTIONS.map((role) => (
            <DropdownMenuItem
              key={role}
              className="capitalize"
              onClick={() => setPendingRole(role)}
            >
              {role}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        variant="destructive"
        size="sm"
        disabled={tooMany}
        onClick={() => setConfirmRemove(true)}
      >
        Remove
      </Button>
      <Button variant="ghost" size="sm" onClick={onClear}>
        <X />
        Clear
      </Button>

      <ConfirmDialog
        open={pendingRole !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRole(null);
        }}
        title={`Change ${plural(count, "member")} to ${pendingRole}?`}
        description={[
          pendingRole === "admin"
            ? "Admins can manage members, invitations, and conversations across the workspace."
            : demotesAdmins
              ? "Admins in the selection will lose admin privileges."
              : "Their access changes as soon as you confirm.",
          "If any change is refused, nobody's role changes.",
        ].join(" ")}
        confirmLabel="Change roles"
        destructive={pendingRole !== "admin" && demotesAdmins}
        onConfirm={async () => {
          if (pendingRole) await applyRole(pendingRole);
        }}
      />
      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={`Remove ${plural(count, "member")}?`}
        description="They will immediately lose access to this workspace and will be removed from the Clerk organization. They can be re-invited later."
        confirmLabel="Remove members"
        destructive
        onConfirm={remove}
      />
    </div>
  );
}

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function AdminUsersPage() {
  const me = useQuery(api.users.getMe);
  const stats = useQuery(api.users.getOrgMembershipStats);
  const departments = useQuery(api.departments.listAll);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [departmentFilter, setDepartmentFilter] =
    useState<DepartmentFilter>("all");
  const [selectedIds, setSelectedIds] = useState<Set<Id<"memberships">>>(
    () => new Set(),
  );
  const [editing, setEditing] = useState<PlacementMember | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invitesRefreshKey, setInvitesRefreshKey] = useState(0);
  const debouncedSearch = useDebouncedValue(search.trim(), 250);
  const { results, status, loadMore } = usePaginatedQuery(
    api.users.listOrgMembersPage,
    {
      search: debouncedSearch || undefined,
      role: roleFilter === "all" ? undefined : roleFilter,
      department: departmentFilter === "all" ? undefined : departmentFilter,
    },
    { initialNumItems: 50 },
  );
  // A new search restarts pagination. Keep the previous rows on screen until
  // it lands, so the table updates in place and the search box keeps focus.
  const loadingFirstPage = status === "LoadingFirstPage";
  const members = useLastLoaded(results, loadingFirstPage);
  const refreshing = loadingFirstPage && members.length > 0;

  const departmentItems = useMemo<Record<string, string>>(
    () => ({
      all: "All departments",
      unplaced: "Not placed",
      ...Object.fromEntries(
        (departments ?? []).map((department) => [
          department._id,
          `${department.name} · ${department.functionName}`,
        ]),
      ),
    }),
    [departments],
  );
  const departmentGroups = useMemo(
    () => groupDepartments(departments ?? []),
    [departments],
  );

  // The stats document counts every member by role; a search or department
  // filter has no count, so the footer just says how many are loaded.
  const total =
    stats && !debouncedSearch && departmentFilter === "all"
      ? roleFilter === "all"
        ? stats.activeCount
        : roleFilter === "admin"
          ? stats.adminCount
          : roleFilter === "contributor"
            ? stats.contributorCount
            : stats.viewerCount
      : null;

  const selectable = members.filter((m) => m.userId !== me?._id);
  const selectedMembers = members.filter((m) => selectedIds.has(m.membershipId));
  const allSelected =
    selectable.length > 0 &&
    selectable.every((m) => selectedIds.has(m.membershipId));
  const someSelected = selectedMembers.length > 0 && !allSelected;

  const clearSelection = () => setSelectedIds(new Set());
  const toggleSelected = (id: Id<"memberships">, checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  if (me === undefined) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
      </div>
    );
  }

  const filtered =
    Boolean(debouncedSearch) || roleFilter !== "all" || departmentFilter !== "all";

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Members</h2>
          <p className="text-sm text-muted-foreground">
            Manage members and roles for this organization.
          </p>
        </div>
        <Button onClick={() => setInviteOpen(true)}>
          <UserPlus />
          Invite members
        </Button>
      </div>

      {/* Search and filters. Any change clears the selection, so a bulk
          action never reaches rows the admin can no longer see. */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name, email, job title…"
            aria-label="Search members"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              clearSelection();
            }}
            className="pl-9"
          />
        </div>
        <div
          role="group"
          aria-label="Filter by role"
          className="flex flex-wrap gap-1.5"
        >
          {ROLE_FILTERS.map((filter) => (
            <Button
              key={filter.value}
              type="button"
              variant={roleFilter === filter.value ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={roleFilter === filter.value}
              onClick={() => {
                setRoleFilter(filter.value);
                clearSelection();
              }}
            >
              {filter.label}
            </Button>
          ))}
        </div>
        <Select
          value={departmentFilter as string}
          items={departmentItems}
          onValueChange={(value) => {
            setDepartmentFilter(value as DepartmentFilter);
            clearSelection();
          }}
        >
          <SelectTrigger
            size="sm"
            className="w-[220px]"
            aria-label="Filter by department"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All departments</SelectItem>
            <SelectItem value="unplaced">Not placed</SelectItem>
            {departmentGroups.map(([functionName, options]) => (
              <SelectGroup key={functionName}>
                <SelectLabel>{functionName}</SelectLabel>
                {options.map((option) => (
                  <SelectItem key={option._id} value={option._id}>
                    {option.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>

      {selectedMembers.length > 0 && (
        <BulkActions selected={selectedMembers} onClear={clearSelection} />
      )}

      {/* Table */}
      <div
        className={cn("rounded-lg border transition-opacity", refreshing && "opacity-60")}
        aria-busy={loadingFirstPage}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={allSelected}
                  indeterminate={someSelected}
                  disabled={selectable.length === 0}
                  onCheckedChange={(checked) =>
                    setSelectedIds(
                      checked
                        ? new Set(selectable.map((m) => m.membershipId))
                        : new Set(),
                    )
                  }
                  aria-label="Select all loaded members"
                />
              </TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className={COLUMN_CLASS.jobTitle}>Job Title</TableHead>
              <TableHead className={COLUMN_CLASS.department}>
                Department
              </TableHead>
              <TableHead className={COLUMN_CLASS.platform}>Platform</TableHead>
              <TableHead className={COLUMN_CLASS.profile}>Profile</TableHead>
              <TableHead className={COLUMN_CLASS.joined}>Joined Org</TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="h-24 text-center text-muted-foreground"
                >
                  {loadingFirstPage ? (
                    <div
                      className="mx-auto h-5 w-5 animate-spin rounded-full border-2 border-primary/30 border-t-primary"
                      role="status"
                      aria-label="Loading members"
                    />
                  ) : filtered ? (
                    "No members match these filters."
                  ) : (
                    "No members yet."
                  )}
                </TableCell>
              </TableRow>
            ) : (
              members.map((m) => {
                const role = m.role as Role;
                const isSelf = me?._id === m.userId;
                return (
                  <TableRow
                    key={m.membershipId}
                    data-state={
                      selectedIds.has(m.membershipId) ? "selected" : undefined
                    }
                  >
                    <TableCell>
                      {!isSelf && (
                        <Checkbox
                          checked={selectedIds.has(m.membershipId)}
                          onCheckedChange={(checked) =>
                            toggleSelected(m.membershipId, checked)
                          }
                          aria-label={`Select ${m.name}`}
                        />
                      )}
                    </TableCell>
                    {/* Name is the only column that wraps, so on a phone it
                        takes whatever width the others leave. From sm it
                        keeps a floor, so a crowded table scrolls instead of
                        squeezing it. */}
                    <TableCell className="whitespace-normal">
                      <div className="wrap-anywhere sm:min-w-40">
                        <span className="font-medium">{m.name}</span>
                        {isSelf && (
                          <span className="ml-1.5 text-xs text-muted-foreground">
                            (you)
                          </span>
                        )}
                        <span className="block text-xs text-muted-foreground">
                          {m.email}
                        </span>
                        {!m.profileComplete && (
                          <span className="block text-xs text-muted-foreground sm:hidden">
                            Profile incomplete
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <RoleSelect
                        membershipId={m.membershipId}
                        currentRole={role}
                        isSelf={isSelf}
                        memberName={m.name}
                      />
                    </TableCell>
                    <TableCell className={COLUMN_CLASS.jobTitle}>
                      {m.jobTitle ?? (
                        <span className="text-muted-foreground">--</span>
                      )}
                    </TableCell>
                    <TableCell className={COLUMN_CLASS.department}>
                      {m.departmentName ? (
                        <>
                          {m.departmentName}
                          <span className="block text-xs text-muted-foreground">
                            {m.functionName}
                          </span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">--</span>
                      )}
                    </TableCell>
                    <TableCell className={COLUMN_CLASS.platform}>
                      {m.platformRole === "superAdmin" ? (
                        <Badge variant="default">Super Admin</Badge>
                      ) : (
                        <span className="text-muted-foreground">--</span>
                      )}
                    </TableCell>
                    <TableCell className={COLUMN_CLASS.profile}>
                      <Badge
                        variant={m.profileComplete ? "secondary" : "outline"}
                      >
                        {m.profileComplete ? "Complete" : "Incomplete"}
                      </Badge>
                    </TableCell>
                    <TableCell
                      className={cn(COLUMN_CLASS.joined, "text-muted-foreground")}
                    >
                      {formatDate(m.createdAt)}
                    </TableCell>
                    <TableCell>
                      <RowActions
                        member={m}
                        isSelf={isSelf}
                        onEditPlacement={() =>
                          setEditing({
                            membershipId: m.membershipId,
                            name: m.name,
                            email: m.email,
                            departmentId: m.departmentId,
                            jobTitleOverride: m.jobTitleOverride,
                            profileJobTitle: m.profileJobTitle,
                          })
                        }
                      />
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {total !== null && total > members.length
            ? `Showing ${members.length} of ${plural(total, "member")}`
            : `Showing ${plural(members.length, "member")}`}
        </p>
        {(status === "CanLoadMore" || status === "LoadingMore") && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadMore(50)}
            disabled={status === "LoadingMore"}
          >
            {status === "LoadingMore" ? "Loading…" : "Load more"}
          </Button>
        )}
      </div>

      <div className="space-y-3 pt-4">
        <div>
          <h3 className="text-sm font-semibold">Pending invitations</h3>
          <p className="text-xs text-muted-foreground">
            People who&apos;ve been invited but haven&apos;t joined yet.
          </p>
        </div>
        <PendingInvitesList refreshKey={invitesRefreshKey} />
      </div>

      <InviteMemberDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onInvited={() => setInvitesRefreshKey((k) => k + 1)}
      />

      <EditPlacementDialog
        member={editing}
        departments={departments}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      />
    </div>
  );
}
