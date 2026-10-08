import {
  Building2,
  Factory,
  Hammer,
  Handshake,
  Landmark,
  Leaf,
  MoreHorizontal,
  RefreshCw,
  ShoppingBag,
  Wallet,
  Wrench,
} from "lucide-react";

const icons = {
  working_capital: Wallet,
  equipment_purchase: Wrench,
  real_estate_purchase: Building2,
  business_acquisition: Handshake,
  property_improvements: Hammer,
  refinance_debt: RefreshCw,
  refinance_real_estate: Landmark,
  other: MoreHorizontal,
  renewable_energy: Leaf,
  construction: Factory,
  conventional: ShoppingBag,
};
export function FundingPurposeIcon({ id }: { id: keyof typeof icons }) {
  const Icon = icons[id];
  return <Icon aria-hidden="true" className="size-6 shrink-0 text-muted-foreground" />;
}
