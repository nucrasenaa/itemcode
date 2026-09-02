[OutputType([string])]
Param(
    [Parameter(Mandatory=$true)]
    [string]$ImagePath
)

$ErrorActionPreference = "Stop"

# Load WinRT assemblies (requires Windows 10/11)
try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
} catch {
    Write-Error "Failed to load System.Runtime.WindowsRuntime. Ensure you are running Windows 10 or 11."
    exit 1
}

$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.RandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]

# Helper to await WinRT async operations in PowerShell
$awaiter = [WindowsRuntimeSystemExtensions].GetMember('GetAwaiter', 'Method', 'Public,Static') | 
           Where-Object { $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | 
           Select-Object -First 1

function Await-WinRT($AsyncTask, $Type) {
    return $awaiter.MakeGenericMethod($Type).Invoke($null, @($AsyncTask)).GetResult()
}

try {
    $absPath = [System.IO.Path]::GetFullPath($ImagePath)
    if (-not (Test-Path $absPath)) {
        Write-Error "Image file not found: $absPath"
        exit 1
    }
    
    # Load storage file
    $fileTask = [Windows.Storage.StorageFile]::GetFileFromPathAsync($absPath)
    $file = Await-WinRT $fileTask ([Windows.Storage.StorageFile])
    
    # Open file stream
    $streamTask = $file.OpenAsync([Windows.Storage.FileAccessMode]::Read)
    $stream = Await-WinRT $streamTask ([Windows.Storage.Streams.IRandomAccessStream])
    
    # Decode image to SoftwareBitmap
    $decoderTask = [Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)
    $decoder = Await-WinRT $decoderTask ([Windows.Graphics.Imaging.BitmapDecoder])
    
    $bitmapTask = $decoder.GetSoftwareBitmapAsync()
    $bitmap = Await-WinRT $bitmapTask ([Windows.Graphics.Imaging.SoftwareBitmap])
    
    # ItemCodes are Latin letters and digits. Use only the explicit English OCR
    # model so accuracy is deterministic and does not depend on Windows profile
    # languages.
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new("en-US"))

    if ($null -eq $engine) {
        Write-Error "English OCR Engine could not be created. Install the English language/OCR pack in Windows Settings."
        exit 1
    }
    
    $ocrTask = $engine.RecognizeAsync($bitmap)
    $result = Await-WinRT $ocrTask ([Windows.Media.Ocr.OcrResult])
    
    # Output recognized lines
    foreach ($line in $result.Lines) {
        Write-Output $line.Text
    }
} catch {
    Write-Error $_.Exception.Message
    exit 1
}
