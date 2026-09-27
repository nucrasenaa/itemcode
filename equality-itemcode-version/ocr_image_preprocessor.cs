using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

public static class ItemCodeOcrImagePrep
{
    public static string[] CreateVariants(string inputPath)
    {
        using (Bitmap source = new Bitmap(inputPath))
        using (Bitmap rgb = new Bitmap(source.Width, source.Height, PixelFormat.Format24bppRgb))
        {
            using (Graphics graphics = Graphics.FromImage(rgb))
                graphics.DrawImage(source, 0, 0, source.Width, source.Height);

            Rectangle rect = new Rectangle(0, 0, rgb.Width, rgb.Height);
            BitmapData sourceData = rgb.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
            int stride = Math.Abs(sourceData.Stride);
            byte[] sourceBytes = new byte[stride * rgb.Height];
            Marshal.Copy(sourceData.Scan0, sourceBytes, 0, sourceBytes.Length);
            rgb.UnlockBits(sourceData);

            int min = 255;
            int max = 0;
            for (int y = 0; y < rgb.Height; y++)
            {
                int row = y * stride;
                for (int x = 0; x < rgb.Width; x++)
                {
                    int i = row + x * 3;
                    int gray = ToGray(sourceBytes[i], sourceBytes[i + 1], sourceBytes[i + 2]);
                    if (gray < min) min = gray;
                    if (gray > max) max = gray;
                }
            }

            List<string> outputs = new List<string>();
            int[] thresholds = new int[] { 240, 245, 250 };
            foreach (int threshold in thresholds)
            {
                using (Bitmap mask = new Bitmap(rgb.Width, rgb.Height, PixelFormat.Format24bppRgb))
                {
                    BitmapData maskData = mask.LockBits(rect, ImageLockMode.WriteOnly, PixelFormat.Format24bppRgb);
                    int maskStride = Math.Abs(maskData.Stride);
                    byte[] maskBytes = new byte[maskStride * mask.Height];
                    for (int y = 0; y < rgb.Height; y++)
                    {
                        int srcRow = y * stride;
                        int dstRow = y * maskStride;
                        for (int x = 0; x < rgb.Width; x++)
                        {
                            int src = srcRow + x * 3;
                            int gray = ToGray(sourceBytes[src], sourceBytes[src + 1], sourceBytes[src + 2]);
                            int normalized = max == min ? gray : (gray - min) * 255 / (max - min);
                            byte value = (byte)(normalized >= threshold ? 255 : 0);
                            int dst = dstRow + x * 3;
                            maskBytes[dst] = value;
                            maskBytes[dst + 1] = value;
                            maskBytes[dst + 2] = value;
                        }
                    }
                    Marshal.Copy(maskBytes, 0, maskData.Scan0, maskBytes.Length);
                    mask.UnlockBits(maskData);

                    string outputPath = Path.Combine(Path.GetTempPath(), "itemcode-ocr-" + Guid.NewGuid().ToString("N") + ".png");
                    using (Bitmap enlarged = new Bitmap(rgb.Width * 2, rgb.Height * 2, PixelFormat.Format24bppRgb))
                    using (Graphics graphics = Graphics.FromImage(enlarged))
                    {
                        graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
                        graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
                        graphics.DrawImage(mask, new Rectangle(0, 0, enlarged.Width, enlarged.Height));
                        enlarged.Save(outputPath, ImageFormat.Png);
                    }
                    outputs.Add(outputPath);
                }
            }
            return outputs.ToArray();
        }
    }

    private static int ToGray(byte blue, byte green, byte red)
    {
        return (red * 299 + green * 587 + blue * 114 + 500) / 1000;
    }
}
