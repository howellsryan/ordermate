import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Link2, ShieldCheck, UserPlus } from "lucide-react";
import type { OrganizationSummary, Role } from "../../shared/types";
import { controlApi, date } from "../api";
import { DataState, ErrorText, Field, PageHeader } from "../ui";

type Member = {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: Role;
  createdAt: number;
};

type PendingInvite = {
  id: string;
  email: string;
  role: Exclude<Role, "owner">;
  expiresAt: number;
  createdAt: number;
};

type TeamResponse = {
  members: Member[];
  pendingInvites: PendingInvite[];
  canManage: boolean;
};

const assignableRoles: Array<Exclude<Role, "owner">> = ["admin", "manager", "inventory", "fulfilment", "viewer"];

export default function Team({ tenant }: { tenant: OrganizationSummary }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Exclude<Role, "owner">>("manager");
  const [inviteUrl, setInviteUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const query = useQuery({
    queryKey: ["team", tenant.id],
    queryFn: () => controlApi<TeamResponse>(`/organizations/${tenant.id}/members`),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["team", tenant.id] });
  const invite = useMutation({
    mutationFn: () => controlApi<{ inviteUrl: string; expiresAt: number }>(`/organizations/${tenant.id}/invites`, {
      method: "POST",
      body: JSON.stringify({ email, role }),
    }),
    onSuccess: data => {
      setInviteUrl(data.inviteUrl);
      setCopied(false);
      setEmail("");
      refresh();
    },
  });
  const updateRole = useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: Exclude<Role, "owner"> }) => controlApi(`/organizations/${tenant.id}/members/${memberId}`, {
      method: "PATCH",
      body: JSON.stringify({ role }),
    }),
    onSuccess: refresh,
  });

  const copyInvite = async () => {
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
  };

  return <>
    <PageHeader eyebrow="Access" title="Team & roles" description="One Google identity can belong to multiple Operating Layer businesses. Membership is verified before any tenant datastore can be reached." />
    {query.data?.canManage && <section className="panel invite-panel">
      <div className="panel-heading"><div><p className="eyebrow">Invite member</p><h3>Share an email-bound link</h3></div><UserPlus size={21} /></div>
      <p>The link expires after seven days and only works when the recipient signs in with the Google account matching the invited email.</p>
      <form className="invite-form" onSubmit={event => { event.preventDefault(); invite.mutate(); }}>
        <Field label="Google email"><input required type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="person@example.com" /></Field>
        <Field label="Role"><select value={role} onChange={event => setRole(event.target.value as Exclude<Role, "owner">)}>{assignableRoles.map(value => <option key={value} value={value}>{labelRole(value)}</option>)}</select></Field>
        <button className="primary" disabled={invite.isPending}><Link2 size={16} /> Create invite link</button>
      </form>
      {invite.error && <ErrorText error={invite.error} />}
      {inviteUrl && <div className="invite-link"><div><strong>Invite ready</strong><code>{inviteUrl}</code></div><button className="secondary" onClick={copyInvite}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? "Copied" : "Copy link"}</button></div>}
    </section>}

    <section className="panel table-panel team-table">
      <DataState loading={query.isLoading} error={query.error || updateRole.error} empty={!query.data?.members.length} emptyText="No members found.">
        <table><thead><tr><th>Member</th><th>Role</th><th>Joined</th><th>Access</th></tr></thead><tbody>{query.data?.members.map(member => <tr key={member.id}><td><strong>{member.name}</strong><small>{member.email}</small></td><td>{query.data?.canManage && member.role !== "owner" ? <select className="inline-select" value={member.role} disabled={updateRole.isPending} onChange={event => updateRole.mutate({ memberId: member.id, role: event.target.value as Exclude<Role, "owner"> })}>{assignableRoles.map(value => <option key={value} value={value}>{labelRole(value)}</option>)}</select> : <strong className="capitalize">{labelRole(member.role)}</strong>}</td><td>{date(member.createdAt)}</td><td><span className="member-access"><ShieldCheck size={14} /> {member.role === "owner" || member.role === "admin" ? "Can manage team" : "Role-scoped"}</span></td></tr>)}</tbody></table>
      </DataState>
    </section>

    {query.data?.canManage && query.data.pendingInvites.length > 0 && <section className="panel pending-panel"><div className="panel-heading"><div><p className="eyebrow">Pending</p><h3>Unused invite links</h3></div></div><div className="pending-list">{query.data.pendingInvites.map(item => <div key={item.id}><span><strong>{item.email}</strong><small>{labelRole(item.role)} · expires {date(item.expiresAt)}</small></span><span className="status">pending</span></div>)}</div></section>}
  </>;
}

function labelRole(role: Role) {
  if (role === "fulfilment") return "Fulfilment";
  return role.charAt(0).toUpperCase() + role.slice(1);
}
