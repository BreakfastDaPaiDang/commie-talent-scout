import React from 'react';
import {Icon} from './icons';
// Promoted from the approved prototype (531ab51). Both applications render these
// components; persistence, permissions and data loading belong to their adapters.
export function IconButton({
  name,
  label,
  ...props
}: {
  name: string;
  label: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className="icon-button" aria-label={label} title={label} {...props}><Icon name={name} /></button>;
}
