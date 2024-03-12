namespace ordermateAPI.Exceptions;

public class ModifierNotFoundException : Exception
{
    public ModifierNotFoundException()
    {
    }

    public ModifierNotFoundException(string message)
        : base(message)
    {
    }
}