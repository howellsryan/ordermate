namespace ordermateAPI.DAL.Models;

public class OrderItemModifierModel
{
    public int OrderItemModifierId { get; set; }
    public int OrderItemId { get; set; }
    public int ModifierId { get; set; }
    public int Quantity { get; set; }
    
    public DateTime CreatedDate { get; set; }
    public DateTime LastModifiedDate { get; set; }
}