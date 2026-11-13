"use client";

import { useControllableState } from "@radix-ui/react-use-controllable-state";
import { blurAfterPointerClick } from "@/components/focus-hygiene";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { ChevronDownIcon } from "@/components/ui/icons";
import { OwlBusy } from "@/components/owl/owl-busy";
import type { ComponentProps, ReactNode } from "react";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Streamdown } from "streamdown";

import { transformMathDelimiters } from "@/src/core";
import { streamdownPlugins, streamdownRehypePlugins, streamdownRemend } from "./message";
import { mdComponents } from "@/components/md-blocks";
import { Shimmer } from "./shimmer";

interface ReasoningContextValue {
  isStreaming: boolean;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
}

const ReasoningContext = createContext<ReasoningContextValue | null>(null);

export const useReasoning = () => {
  const context = useContext(ReasoningContext);
  if (!context) {
    throw new Error("Reasoning components must be used within Reasoning");
  }
  return context;
};

export type ReasoningProps = ComponentProps<typeof Collapsible> & {
  isStreaming?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
};

const AUTO_CLOSE_DELAY = 1000;

export const Reasoning = memo(
  ({
    className,
    isStreaming = false,
    open,
    defaultOpen,
    onOpenChange,
    children,
    ...props
  }: ReasoningProps) => {
    const resolvedDefaultOpen = defaultOpen ?? false;

    const [isOpen, setIsOpen] = useControllableState<boolean>({
      defaultProp: resolvedDefaultOpen,
      onChange: onOpenChange,
      prop: open,
    });
    const hasEverStreamedRef = useRef(isStreaming);
    const [hasAutoClosed, setHasAutoClosed] = useState(false);

    useEffect(() => {
      if (
        hasEverStreamedRef.current &&
        !isStreaming &&
        isOpen &&
        !hasAutoClosed
      ) {
        const timer = setTimeout(() => {
          setIsOpen(false);
          setHasAutoClosed(true);
        }, AUTO_CLOSE_DELAY);

        return () => clearTimeout(timer);
      }
    }, [isStreaming, isOpen, setIsOpen, hasAutoClosed]);

    const handleOpenChange = useCallback(
      (newOpen: boolean) => {
        setIsOpen(newOpen);
      },
      [setIsOpen]
    );

    const contextValue = useMemo(
      () => ({ isOpen, isStreaming, setIsOpen }),
      [isOpen, isStreaming, setIsOpen]
    );

    return (
      <ReasoningContext.Provider value={contextValue}>
        <Collapsible
          className={cn("not-prose mb-4", className)}
          onOpenChange={handleOpenChange}
          open={isOpen}
          {...props}
        >
          {children}
        </Collapsible>
      </ReasoningContext.Provider>
    );
  }
);

export type ReasoningTriggerProps = ComponentProps<
  typeof CollapsibleTrigger
> & {
  getThinkingMessage?: (isStreaming: boolean) => ReactNode;
};

const defaultGetThinkingMessage = (isStreaming: boolean) => {
  if (isStreaming) {
    return <Shimmer duration={1}>Thinking...</Shimmer>;
  }
  return <p>Owlly’s thinking</p>;
};

export const ReasoningTrigger = memo(
  ({
    className,
    children,
    getThinkingMessage = defaultGetThinkingMessage,
    ...props
  }: ReasoningTriggerProps) => {
    const { isStreaming, isOpen } = useReasoning();

    return (
      <CollapsibleTrigger
        className={cn(
          "flex w-fit cursor-pointer items-center gap-2 rounded-xl bg-muted/70 px-3 py-1.5 text-muted-foreground text-xs font-extrabold transition-colors hover:text-foreground",
          className
        )}
        {...props}
        onClick={(e) => blurAfterPointerClick(e)}
      >
        {children ?? (
          <>
            {
}
            {isStreaming && <OwlBusy label="Thinking" />}
            {getThinkingMessage(isStreaming)}
            <ChevronDownIcon
              className={cn(
                "size-4 transition-transform",
                isOpen ? "rotate-180" : "rotate-0"
              )}
            />
          </>
        )}
      </CollapsibleTrigger>
    );
  }
);

export type ReasoningContentProps = ComponentProps<
  typeof CollapsibleContent
> & {
  children: string;
};


export const ReasoningContent = memo(
  ({ className, children, ...props }: ReasoningContentProps) => (
    <CollapsibleContent
      className={cn(
        "mt-3 rounded-2xl border-l-4 border-secondary/30 bg-muted/40 px-4 py-2 text-sm",
        "data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 text-muted-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
        className
      )}
      {...props}
    >
      <Streamdown components={mdComponents} plugins={streamdownPlugins} rehypePlugins={streamdownRehypePlugins} remend={streamdownRemend}>
        {transformMathDelimiters(children)}
      </Streamdown>
    </CollapsibleContent>
  )
);

Reasoning.displayName = "Reasoning";
ReasoningTrigger.displayName = "ReasoningTrigger";
ReasoningContent.displayName = "ReasoningContent";
