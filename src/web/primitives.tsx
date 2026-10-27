import { Select, Switch, Dialog } from 'radix-ui';
import { Check, ChevronDown, X } from 'lucide-react';
import type { ReactNode } from 'react';
const nonce = document.querySelector<HTMLMetaElement>('meta[property="csp-nonce"]')?.content;
export function Choice({
  id,
  value,
  onChange,
  label,
  items,
  disabled = false,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  label: string;
  items: { value: string; label: string; disabled?: boolean }[];
  disabled?: boolean;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <Select.Root value={value} onValueChange={onChange} disabled={disabled}>
        <Select.Trigger id={id} className="select">
          <Select.Value />
          <Select.Icon>
            <ChevronDown size={16} />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content className="select-menu" position="popper" sideOffset={6}>
            <Select.Viewport nonce={nonce}>
              {items.map((item) => (
                <Select.Item
                  key={item.value}
                  value={item.value}
                  disabled={item.disabled}
                  className="select-item"
                >
                  <Select.ItemText>{item.label}</Select.ItemText>
                  <Select.ItemIndicator>
                    <Check size={14} />
                  </Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </div>
  );
}
export function Toggle({
  id,
  checked,
  onChange,
  label,
  detail,
  disabled = false,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  detail?: string;
  disabled?: boolean;
}) {
  return (
    <div className="toggle-row">
      <div>
        <label htmlFor={id}>{label}</label>
        {detail && <p className="muted small">{detail}</p>}
      </div>
      <Switch.Root
        id={id}
        className="switch"
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
      >
        <Switch.Thumb className="switch-thumb" />
      </Switch.Root>
    </div>
  );
}
export function Modal({
  open,
  onChange,
  title,
  description,
  children,
  closeLabel,
  trigger,
}: {
  open: boolean;
  onChange: (v: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
  closeLabel: string;
  trigger?: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onChange}>
      {trigger && <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>}
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content className="modal">
          <div className="modal-heading">
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              <Dialog.Description>{description}</Dialog.Description>
            </div>
            <Dialog.Close className="icon-button" aria-label={closeLabel}>
              <X size={20} />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
