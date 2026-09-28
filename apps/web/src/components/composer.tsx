import { ArrowUp, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type ComposerProps = {
  onSend: (text: string) => void;
  onStop: () => void;
  streaming: boolean;
  disabled?: boolean;
};

export function Composer({ onSend, onStop, streaming, disabled }: ComposerProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const submit = useCallback(() => {
    const text = value.trim();
    if (!text || streaming || disabled) return;
    setValue("");
    onSend(text);
  }, [disabled, onSend, streaming, value]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`;
  }, [value]);

  return (
    <div className="border-t bg-background/80 px-4 py-3 backdrop-blur">
      <div className="mx-auto flex w-full max-w-3xl items-end gap-2">
        <Textarea
          ref={textareaRef}
          value={value}
          disabled={disabled}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder={disabled ? "先新建一个会话" : "输入消息，Enter 发送，Shift+Enter 换行"}
          className="max-h-[220px] min-h-[44px] resize-none"
        />

        {streaming ? (
          <Button variant="outline" size="icon" onClick={onStop} title="停止生成">
            <Square className="size-4" />
          </Button>
        ) : (
          <Button size="icon" onClick={submit} disabled={disabled || value.trim().length === 0} title="发送">
            <ArrowUp className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
