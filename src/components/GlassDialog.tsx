import * as React from "react"
import { Dialog as DialogPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { Button, buttonVariants } from "@/components/ui/button"
import { XIcon } from "lucide-react"

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

const DialogOverlay = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => {
  return (
    <DialogPrimitive.Overlay
      ref={ref}
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-overlay duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
})

const DialogContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<typeof DialogPrimitive.Content> & {
    showCloseButton?: boolean
    overlayClassName?: string
  }
>(({ className, children, showCloseButton = true, overlayClassName, ...props }, ref) => {
  return (
    <DialogPortal>
      <DialogOverlay className={overlayClassName} />
      <DialogPrimitive.Content
        ref={ref}
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-popover p-5 text-sm text-popover-foreground shadow-2xl ring-1 ring-foreground/10 duration-100 outline-none sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close data-slot="dialog-close" asChild>
             <Button
              variant="ghost"
              className="absolute top-2 right-2 rounded-full hover:text-warning focus-visible:ring-0"
              size="icon-xs"
            >
              <XIcon />
              <span className="sr-only">Close</span>
            </Button>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
})

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "mt-4 flex justify-end gap-2",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "mb-3 font-medium",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

interface GlassDialogButton<T> {
  text: string;
  variant: "primary" | "secondary";
  value: T;
}

interface GlassDialogOptions<T> {
  title: string;
  content?: string | HTMLElement;
  buttons: GlassDialogButton<T>[];
  dismissValue?: T;
  focusButtonIndex?: number;
}

function createButton(
  text: string,
  variant: "primary" | "secondary"
): HTMLButtonElement {
  const btn = document.createElement("button");
  const isPrimary = variant === "primary";
  btn.className = buttonVariants({ variant: isPrimary ? "default" : "outline", size: "sm" }) + " rounded-lg";
  btn.textContent = text;
  return btn;
}

export function showGlassDialog<T>(
  options: GlassDialogOptions<T>
): Promise<T> {
  return new Promise((resolve) => {
    let resolved = false;

    const overlay = document.createElement("div");
    overlay.className =
      "fixed inset-0 isolate z-50 bg-overlay";

    const card = document.createElement("div");
    card.className =
      "fixed top-1/2 left-1/2 z-50 w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-popover p-5 text-sm text-popover-foreground shadow-2xl ring-1 ring-foreground/10 sm:max-w-sm";

    const title = document.createElement("div");
    title.className = "mb-3 font-medium text-foreground";
    title.textContent = options.title;

    const body = document.createElement("div");
    body.className = "mb-4 text-sm text-muted-foreground";
    if (options.content) {
      if (typeof options.content === "string") {
        body.textContent = options.content;
      } else {
        body.appendChild(options.content);
      }
    } else {
      body.classList.add("hidden");
    }

    function cleanup(result: T) {
      if (resolved) return;
      resolved = true;
      document.removeEventListener("keydown", onKey);
      overlay.classList.add("opacity-0", "transition-opacity", "duration-150");
      card.classList.add(
        "opacity-0",
        "scale-95",
        "transition-all",
        "duration-200",
        "ease-out"
      );
      setTimeout(() => {
        overlay.parentNode?.removeChild(overlay);
        card.parentNode?.removeChild(card);
        resolve(result);
      }, 200);
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && options.dismissValue !== undefined) {
        cleanup(options.dismissValue);
      }
    }

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay && options.dismissValue !== undefined) {
        cleanup(options.dismissValue);
      }
    });

    const actions = document.createElement("div");
    actions.className = "mt-4 flex justify-end gap-2";

    const buttons: HTMLButtonElement[] = [];
    for (const config of options.buttons) {
      const btn = createButton(config.text, config.variant);
      btn.addEventListener("click", () => cleanup(config.value));
      actions.appendChild(btn);
      buttons.push(btn);
    }

    document.addEventListener("keydown", onKey);

    card.appendChild(title);
    card.appendChild(body);
    card.appendChild(actions);
    document.body.appendChild(overlay);
    document.body.appendChild(card);

    const focusIndex = options.focusButtonIndex ?? buttons.length - 1;
    buttons[focusIndex]?.focus();
  });
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
