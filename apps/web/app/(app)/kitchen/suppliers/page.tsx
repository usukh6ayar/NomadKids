"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { paginated, supplierSchema, type Supplier } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { ArchiveButton } from "@/components/ui/archive-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataList, DataRow } from "@/components/ui/data-list";
import { Field, Input, Textarea } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { Pagination, ResultCount } from "@/components/ui/pagination";
import { useToast } from "@/components/ui/toast";
import { SearchField } from "@/components/ui/search-field";
import { useDebounced } from "@/lib/use-debounced";

const suppliersSchema = paginated(supplierSchema);

const COLUMNS = [
  { key: "contact", label: "Холбоо барих", className: "md:w-[220px]" },
  { key: "origin", label: "Гарал үүсэл", className: "md:w-[260px]" },
];

/**
 * Нийлүүлэгч — who the kitchen buys from, and нэмэлт.md's "гарал үүсэл":
 * where the food comes from, kept as a note against the supplier rather than
 * a certification registry this product does not run.
 */
export default function SuppliersPage() {
  return (
    <RequireRole roles={["COOK", "ADMIN"]}>
      <Suppliers />
    </RequireRole>
  );
}

function Suppliers() {
  const { session } = useSession();
  const kindergartenId = session?.memberships?.[0]?.kindergartenId ?? null;
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const q = useDebounced(query);

  const list = useQuery({
    enabled: Boolean(kindergartenId),
    queryKey: qk.kitchen.suppliers(kindergartenId ?? "", { page, q }),
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: "25" });
      if (q) params.set("q", q);
      return get(`/kindergartens/${kindergartenId}/suppliers?${params}`, suppliersSchema);
    },
  });

  const items = list.data?.items ?? [];

  return (
    <div className="flex flex-col gap-5 lg:gap-6">
      <PageHeader
        title="Нийлүүлэгч"
        lede="Хүнсний захиалга өгөх байгууллагууд, тэдгээрийн гарал үүсэл."
        actions={
          kindergartenId ? (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus size={18} />
              Нийлүүлэгч нэмэх
            </Button>
          ) : null
        }
      />

      {kindergartenId ? (
        <div className="flex flex-wrap items-end gap-3">
          <SearchField
            label="Нийлүүлэгчийн нэр, регистр, холбоо барих хүнээр хайх"
            placeholder="Нэр эсвэл регистрээр хайх"
            value={query}
            onChange={setQuery}
          />
        </div>
      ) : null}

      {list.isLoading ? <LoadingState rows={3} /> : null}
      {list.isError ? <ErrorState description={errorMessage(list.error)} /> : null}

      {list.data && items.length === 0 ? (
        <EmptyState
          title="Нийлүүлэгч бүртгэгдээгүй байна"
          description="Хүнсний захиалга өгөхийн өмнө нийлүүлэгчээ бүртгэнэ үү."
        />
      ) : null}

      {items.length > 0 ? (
        <>
          <ResultCount total={list.data?.total ?? 0} noun="нийлүүлэгч" />
          <DataList columns={COLUMNS} leadWidth={null} actionsWidth="w-[164px]">
            {items.map((supplier) => (
              <SupplierRow key={supplier.id} supplier={supplier} />
            ))}
          </DataList>
          <Pagination page={page} totalPages={list.data?.totalPages ?? 1} onPage={setPage} />
        </>
      ) : null}

      {creating && kindergartenId ? (
        <SupplierFormDialog
          kindergartenId={kindergartenId}
          open={creating}
          onOpenChange={setCreating}
        />
      ) : null}
    </div>
  );
}

function SupplierRow({ supplier }: { supplier: Supplier }) {
  const [editing, setEditing] = useState(false);

  return (
    <>
      <DataRow
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 truncate">{supplier.name}</span>
            {!supplier.isActive ? <Badge tone="neutral">Идэвхгүй</Badge> : null}
          </span>
        }
        subtitle={supplier.registrationNumber ?? undefined}
        cells={{
          contact: (
            <span className="text-body text-muted">
              {[supplier.contactPerson, supplier.contactPhone].filter(Boolean).join(" · ") || "—"}
            </span>
          ),
          origin: <span className="text-body text-muted">{supplier.originNote ?? "—"}</span>,
        }}
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              <Pencil size={16} aria-hidden="true" />
              Засах
            </Button>
            <ArchiveButton
              path={`/suppliers/${supplier.id}`}
              label="Архивлах"
              confirmation={`"${supplier.name}" нийлүүлэгчийг архивлах уу?`}
              invalidate={[["kitchen", "suppliers"]]}
              variant="ghost"
            />
          </>
        }
      />

      {editing ? (
        <SupplierFormDialog supplier={supplier} open={editing} onOpenChange={setEditing} />
      ) : null}
    </>
  );
}

function SupplierFormDialog({
  kindergartenId,
  supplier,
  open,
  onOpenChange,
}: {
  kindergartenId?: string;
  supplier?: Supplier;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const isEdit = Boolean(supplier);

  const [name, setName] = useState(supplier?.name ?? "");
  const [registrationNumber, setRegistrationNumber] = useState(supplier?.registrationNumber ?? "");
  const [contactPerson, setContactPerson] = useState(supplier?.contactPerson ?? "");
  const [contactPhone, setContactPhone] = useState(supplier?.contactPhone ?? "");
  const [address, setAddress] = useState(supplier?.address ?? "");
  const [originNote, setOriginNote] = useState(supplier?.originNote ?? "");

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        registrationNumber: registrationNumber.trim() || null,
        contactPerson: contactPerson.trim() || null,
        contactPhone: contactPhone.trim() || null,
        address: address.trim() || null,
        originNote: originNote.trim() || null,
      };
      return isEdit
        ? mutate(`/suppliers/${supplier!.id}`, supplierSchema, { method: "PATCH", body })
        : mutate(`/kindergartens/${kindergartenId}/suppliers`, supplierSchema, {
            method: "POST",
            body: { ...body, isActive: true },
          });
    },
    onSuccess: () => {
      toast.success(isEdit ? "Нийлүүлэгч хадгалагдлаа." : "Нийлүүлэгч нэмэгдлээ.");
      void queryClient.invalidateQueries({ queryKey: ["kitchen", "suppliers"] });
      onOpenChange(false);
    },
  });

  const errors = fieldErrors(save.error);

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      busy={save.isPending}
      title={isEdit ? "Нийлүүлэгч засах" : "Нийлүүлэгч нэмэх"}
      footer={
        <>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={save.isPending}
            onClick={() => onOpenChange(false)}
          >
            Болих
          </Button>
          <Button type="submit" form="supplier-form" size="sm" disabled={save.isPending}>
            {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
          </Button>
        </>
      }
    >
      <form
        id="supplier-form"
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim() && !save.isPending) save.mutate();
        }}
      >
        <FormError
          message={
            save.isError && Object.keys(errors).length === 0 ? errorMessage(save.error) : null
          }
        />

        <Field label="Нэр" error={errors.name} required>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          )}
        </Field>

        <Field label="Регистрийн дугаар" error={errors.registrationNumber}>
          {({ id }) => (
            <Input
              id={id}
              value={registrationNumber}
              onChange={(e) => setRegistrationNumber(e.target.value)}
            />
          )}
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Харилцах хүн" error={errors.contactPerson}>
            {({ id }) => (
              <Input
                id={id}
                value={contactPerson}
                onChange={(e) => setContactPerson(e.target.value)}
              />
            )}
          </Field>
          <Field label="Утас" error={errors.contactPhone}>
            {({ id }) => (
              <Input
                id={id}
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
              />
            )}
          </Field>
        </div>

        <Field label="Хаяг" error={errors.address}>
          {({ id }) => (
            <Input id={id} value={address} onChange={(e) => setAddress(e.target.value)} />
          )}
        </Field>

        <Field
          label="Гарал үүсэл"
          error={errors.originNote}
          hint="Хүнс хаанаас ирдэг, гэрчилгээ гэх мэт"
        >
          {({ id }) => (
            <Textarea
              id={id}
              value={originNote}
              onChange={(e) => setOriginNote(e.target.value)}
              rows={2}
            />
          )}
        </Field>
      </form>
    </FormDialog>
  );
}
